"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  PiggyBank,
  Phone,
  Home,
  ReceiptJapaneseYen,
  Landmark,
  Plus,
  Trash2,
  CheckCircle2,
  GripVertical,
  Download,
  Upload,
  X,
  Calendar,
  FileText,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  Settings,
  LogOut,
} from "lucide-react";
import { motion, AnimatePresence, useSpring, useTransform, Reorder, useDragControls } from "framer-motion";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { getOrCreateProfile, joinHousehold, getHouseholdMembers, updateProfile, uploadAvatar } from "@/lib/db";
import { Copy, Users, UserPlus2, RefreshCw, User, Shield, Key, Camera, Check, LogOut as LogOutIcon, Image as ImageIcon } from "lucide-react";
import { adminCreateUserAction, adminDeleteHouseholdMemberAction, adminPurgeHouseholdDataAction } from "@/app/actions/admin-actions";

type Entry = {
  id: string | number; // Changed to allow string UUID
  name: string;
  amount: number;
  note: string;
  date: string;
  done: boolean;
  locked?: boolean;
  lockedKey?: string;
  created_by?: string;
  origin_scope?: DataScope;
};

type DetailGroup = "income" | "otherIncome" | "fixedExpenses" | "variableExpenses" | "communications" | "loans";

const todayStr = new Date().toISOString().slice(0, 10);
const currentMonthKey = todayStr.slice(0, 7); // "YYYY-MM"

type MonthKey = string;

export type KakeiboStoredData = {
  incomeByMonth: Record<MonthKey, Entry[]>;
  otherIncomeByMonth: Record<MonthKey, Entry[]>;
  fixedExpensesByMonth: Record<MonthKey, Entry[]>;
  variableExpensesByMonth: Record<MonthKey, Entry[]>;
  communicationsByMonth: Record<MonthKey, Entry[]>;
  loansByMonth: Record<MonthKey, Entry[]>;
  dailyByDate: Record<string, Entry[]>;
};

type DataScope = "personal" | "group";

const STORAGE_KEY = "kakeibo-data";
const STORAGE_KEY_PERSONAL = "kakeibo-personal-data";
const STORAGE_KEY_SCOPE = "kakeibo-data-scope";
const STORAGE_KEY_VIEW = "kakeibo-active-view";

function storageKeyForScope(scope: DataScope): string {
  return scope === "group" ? STORAGE_KEY : STORAGE_KEY_PERSONAL;
}

function loadFromStorage(storageKey: string): KakeiboStoredData {
  if (typeof window === "undefined") return getEmptyData();
  try {
    const s = localStorage.getItem(storageKey);
    if (!s) return getEmptyData();
    const parsed = JSON.parse(s) as Partial<KakeiboStoredData>;
    return {
      incomeByMonth: parsed.incomeByMonth ?? {},
      otherIncomeByMonth: parsed.otherIncomeByMonth ?? {},
      fixedExpensesByMonth: parsed.fixedExpensesByMonth ?? {},
      variableExpensesByMonth: parsed.variableExpensesByMonth ?? {},
      communicationsByMonth: parsed.communicationsByMonth ?? {},
      loansByMonth: parsed.loansByMonth ?? {},
      dailyByDate: parsed.dailyByDate ?? {},
    };
  } catch {
    return getEmptyData();
  }
}

function getEmptyData(): KakeiboStoredData {
  return {
    incomeByMonth: {},
    otherIncomeByMonth: {},
    fixedExpensesByMonth: {},
    variableExpensesByMonth: {},
    communicationsByMonth: {},
    loansByMonth: {},
    dailyByDate: {},
  };
}

function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isUuidLike(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith("daily-rollup-") || value.startsWith("comm-rollup-")) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeEntry(e: any): Entry {
  const locked = Boolean(e?.locked) || typeof e?.lockedKey === "string";
  const id = locked ? e?.id : isUuidLike(e?.id) ? e.id : generateUUID();
  return {
    id,
    name: typeof e?.name === "string" ? e.name : "",
    amount: Number(e?.amount) || 0,
    note: typeof e?.note === "string" ? e.note : "",
    date: typeof e?.date === "string" ? e.date : todayStr,
    done: typeof e?.done === "boolean" ? e.done : true,
    locked: e?.locked,
    lockedKey: e?.lockedKey,
    created_by: e?.created_by,
    origin_scope: e?.origin_scope,
  };
}

function normalizeStoredData(data: KakeiboStoredData): KakeiboStoredData {
  const normalizeByMonth = (m: Record<MonthKey, Entry[]>) => {
    const next: Record<MonthKey, Entry[]> = {};
    for (const [k, list] of Object.entries(m ?? {})) {
      next[k] = (list ?? []).map(normalizeEntry);
    }
    return next;
  };
  const nextDaily: Record<string, Entry[]> = {};
  for (const [d, list] of Object.entries(data.dailyByDate ?? {})) {
    nextDaily[d] = (list ?? []).map((x) => normalizeEntry({ ...x, date: d }));
  }
  return {
    incomeByMonth: normalizeByMonth(data.incomeByMonth),
    otherIncomeByMonth: normalizeByMonth(data.otherIncomeByMonth),
    fixedExpensesByMonth: normalizeByMonth(data.fixedExpensesByMonth),
    variableExpensesByMonth: normalizeByMonth(data.variableExpensesByMonth),
    communicationsByMonth: normalizeByMonth(data.communicationsByMonth),
    loansByMonth: normalizeByMonth(data.loansByMonth),
    dailyByDate: nextDaily,
  };
}

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<"main" | "monthly" | "daily" | "settings">("main");
  const [dataScope, setDataScope] = useState<DataScope>("personal");
  const [groupNavOpen, setGroupNavOpen] = useState(false);
  const [month, setMonth] = useState<MonthKey>(currentMonthKey);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      // 状態をクリア
      setUser(null);
      setProfile(null);
      
      // 遷移
      router.replace("/login");
    } catch (err) {
      console.error("Logout error:", err);
      // エラーでも強制的に戻す
      router.replace("/login");
    }
  };

  const [joinId, setJoinId] = useState("");
  const [householdMembers, setHouseholdMembers] = useState<any[]>([]);
  const [editingProfile, setEditingProfile] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newShareWithGroup, setNewShareWithGroup] = useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isCreatingSubAccount, setIsCreatingSubAccount] = useState(false);
  const [subId, setSubId] = useState("");
  const [subPassword, setSubPassword] = useState("");
  const [subDisplayName, setSubDisplayName] = useState("");
  const [adminDangerOpen, setAdminDangerOpen] = useState(false);
  const [adminDangerPassword, setAdminDangerPassword] = useState("");
  const [adminDangerChecked, setAdminDangerChecked] = useState(false);
  const [adminDangerBusy, setAdminDangerBusy] = useState(false);
  const [deleteMemberTarget, setDeleteMemberTarget] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (profile?.household_id) {
      getHouseholdMembers(profile.household_id).then(setHouseholdMembers);
    }
  }, [profile?.household_id]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const syncAllToSupabase = async () => {
    if (!profile?.household_id || !profile?.share_with_group) return;
    
    setSyncing(true);
    try {
      const syncGroup = async (group: DetailGroup, data: Record<MonthKey, Entry[]>) => {
        for (const monthKey in data) {
          for (const entry of data[monthKey]) {
            await syncToSupabase(group, entry);
          }
        }
      };

      await syncGroup("income", incomeByMonth);
      await syncGroup("otherIncome", otherIncomeByMonth);
      await syncGroup("fixedExpenses", fixedExpensesByMonth);
      await syncGroup("variableExpenses", variableExpensesByMonth);
      await syncGroup("communications", communicationsByMonth);
      await syncGroup("loans", loansByMonth);

      for (const date in dailyByDate) {
        for (const entry of dailyByDate[date]) {
          await syncToSupabase("daily", entry);
        }
      }
      
      alert("全データの同期が完了しました。");
    } catch (err) {
      console.error("Sync all error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const removeAllPersonalFromSupabase = async () => {
    if (!user?.id || !profile?.household_id) return;
    setSyncing(true);
    try {
      const { error } = await supabase
        .from("entries")
        .delete()
        .eq("created_by", user.id)
        .eq("origin_scope", "personal");
      if (error) throw error;
      alert("グループから個人項目の共有を解除しました。");
    } catch (err) {
      console.error("Remove personal sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user) return;
    try {
      let avatarUrl = profile?.avatar_url;
      if (avatarFile) {
        avatarUrl = await uploadAvatar(user.id, avatarFile);
      }
      
      const wasSharing = profile?.share_with_group;
      const updatedProfile = await updateProfile(user.id, { 
        full_name: newUsername, 
        avatar_url: avatarUrl,
        share_with_group: newShareWithGroup
      });
      setProfile(updatedProfile);
      setEditingProfile(false);
      setAvatarFile(null);
      setAvatarPreview(null);
      alert("プロフィールを更新しました。");

      // 共有がONになった場合、同期を実行
      if (newShareWithGroup && !wasSharing) {
        if (window.confirm("共有設定がONになりました。これまでに個人モードで作成した項目をグループに反映しますか？")) {
          await syncAllToSupabase();
        }
      } 
      // 共有がOFFになった場合、他のユーザーからは非表示になる旨を通知
      else if (!newShareWithGroup && wasSharing) {
        alert("共有設定がOFFになりました。あなたが個人モードで作成した項目は、他のメンバーの画面から非表示になります。（再度ONにすると再表示されます）");
      }
    } catch (err) {
      console.error("Profile update error:", err);
      alert("更新に失敗しました。");
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    try {
      const updatedProfile = await updateProfile(user.id, { avatar_url: null });
      setProfile(updatedProfile);
      setAvatarFile(null);
      setAvatarPreview(null);
      alert("アイコンを削除しました。");
    } catch (err) {
      console.error("Profile update error:", err);
      alert("更新に失敗しました。");
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword) return;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      alert("パスワード変更に失敗しました: " + error.message);
    } else {
      alert("パスワードを変更しました。");
      setNewPassword("");
      setIsChangingPassword(false);
    }
  };

  const verifyAdminPassword = async (password: string) => {
    if (!user?.email) throw new Error("メールアドレスが取得できません。");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("Supabase設定が見つかりません。");

    const authClient = createSupabaseJsClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { error } = await authClient.auth.signInWithPassword({ email: user.email, password });
    if (error) throw error;
  };

  const openAdminDanger = () => {
    setAdminDangerOpen(true);
    setAdminDangerPassword("");
    setAdminDangerChecked(false);
    setAdminDangerBusy(false);
    setDeleteMemberTarget(null);
  };

  const openDeleteMember = (targetId: string, label: string) => {
    setAdminDangerOpen(true);
    setAdminDangerPassword("");
    setAdminDangerChecked(false);
    setAdminDangerBusy(false);
    setDeleteMemberTarget({ id: targetId, label });
  };

  const closeAdminDanger = () => {
    if (adminDangerBusy) return;
    setAdminDangerOpen(false);
    setAdminDangerPassword("");
    setAdminDangerChecked(false);
    setDeleteMemberTarget(null);
  };

  const runAdminDanger = async () => {
    if (!profile?.household_id) return;
    if (!adminDangerPassword) return;
    if (!adminDangerChecked) return;

    setAdminDangerBusy(true);
    try {
      await verifyAdminPassword(adminDangerPassword);

      if (deleteMemberTarget) {
        const result = await adminDeleteHouseholdMemberAction(deleteMemberTarget.id, profile.household_id);
        if (!result.success) throw new Error(result.error);

        const members = await getHouseholdMembers(profile.household_id);
        setHouseholdMembers(members);
        alert("ユーザーを削除しました。");
      } else {
        const result = await adminPurgeHouseholdDataAction(profile.household_id);
        if (!result.success) throw new Error(result.error);

        const empty = getEmptyData();
        setIncomeByMonth(empty.incomeByMonth);
        setOtherIncomeByMonth(empty.otherIncomeByMonth);
        setFixedExpensesByMonth(empty.fixedExpensesByMonth);
        setVariableExpensesByMonth(empty.variableExpensesByMonth);
        setCommunicationsByMonth(empty.communicationsByMonth);
        setLoansByMonth(empty.loansByMonth);
        setDailyByDate(empty.dailyByDate);

        try {
          localStorage.setItem(storageKeyForScope("group"), JSON.stringify(empty));
        } catch {
          // ignore
        }

        alert("全てのデータを消去しました。");
      }

      closeAdminDanger();
    } catch (err: any) {
      alert(err.message || "処理に失敗しました。");
    } finally {
      setAdminDangerBusy(false);
    }
  };

  const handleCreateSubAccount = async () => {
    if (!subId || !subPassword || !profile?.household_id) return;
    try {
      const result = await adminCreateUserAction(
        subId,
        subPassword,
        subDisplayName,
        profile.household_id
      );

      if (result.success) {
        alert(`アカウントを作成しました。\nユーザーID: ${subId}\n表示名: ${subDisplayName}\n作成したIDとパスワードでログインしてください。`);
        setIsCreatingSubAccount(false);
        setSubId("");
        setSubPassword("");
        setSubDisplayName("");
        
        // メンバー一覧を再取得
        const updatedMembers = await getHouseholdMembers(profile.household_id);
        setHouseholdMembers(updatedMembers);
      } else {
        throw new Error(result.error);
      }
    } catch (err: any) {
      alert("作成に失敗しました: " + err.message);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim() || !user) return;
    try {
      await joinHousehold(user.id, joinId.trim());
      const prof = await getOrCreateProfile(user.id);
      setProfile(prof);
      setDataScope("group");
      setGroupNavOpen(true);
      await syncFromSupabase(prof.household_id, "group");
      setJoinId("");
      alert("世帯に参加しました！");
    } catch (err) {
      alert("世帯への参加に失敗しました。IDを確認してください。");
    }
  };

  const copyHouseholdId = () => {
    if (profile?.household_id) {
      navigator.clipboard.writeText(profile.household_id);
      alert("世帯IDをコピーしました！招待したい家族に伝えてください。");
    }
  };

  const applyDataToState = useCallback((data: KakeiboStoredData) => {
    setIncomeByMonth(data.incomeByMonth);
    setOtherIncomeByMonth(data.otherIncomeByMonth);
    setFixedExpensesByMonth(data.fixedExpensesByMonth);
    setVariableExpensesByMonth(data.variableExpensesByMonth);
    setCommunicationsByMonth(data.communicationsByMonth);
    setLoansByMonth(data.loansByMonth);
    setDailyByDate(data.dailyByDate);
  }, []);

  const switchScope = useCallback(
    async (scope: DataScope) => {
      setDataScope(scope);
      setGroupNavOpen(scope === "group");
      localStorage.setItem(STORAGE_KEY_SCOPE, scope);
      const data = normalizeStoredData(loadFromStorage(storageKeyForScope(scope)));
      applyDataToState(data);
      if (scope === "group" && profile?.household_id) {
        const members = await getHouseholdMembers(profile.household_id);
        setHouseholdMembers(members);
        await syncFromSupabase(profile.household_id, "group");
      } else if (scope === "personal" && profile?.household_id) {
        await syncFromSupabase(profile.household_id, "personal");
      }
    },
    [applyDataToState, profile?.household_id],
  );

  const handleSwipeScopeSwitch = useCallback(
    (offsetX: number, offsetY: number) => {
      const absX = Math.abs(offsetX);
      const absY = Math.abs(offsetY);
      if (absX < 90) return;
      if (absX < absY * 1.2) return;

      if (offsetX < 0 && dataScope !== "group") {
        void switchScope("group");
      } else if (offsetX > 0 && dataScope !== "personal") {
        void switchScope("personal");
      }
    },
    [dataScope, switchScope],
  );

  const shiftMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + offset, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, "0");
    setMonth(`${newY}-${newM}`);
  };

  const setTodayMonth = () => {
    setMonth(currentMonthKey);
  };

  const shiftDailyDay = (offset: number) => {
    setDailyDate((prev) => shiftDateByDays(prev, offset));
  };

  const displayMonthLabel = useMemo(() => {
    const [y, m] = month.split("-");
    return `${y}年 ${parseInt(m, 10)}月`;
  }, [month]);

  // 初回は空で統一（SSR とクライアントの hydration 一致のため）
  const [incomeByMonth, setIncomeByMonth] = useState<Record<MonthKey, Entry[]>>({});
  const [otherIncomeByMonth, setOtherIncomeByMonth] = useState<Record<MonthKey, Entry[]>>({});
  const [fixedExpensesByMonth, setFixedExpensesByMonth] = useState<Record<MonthKey, Entry[]>>({});
  const [variableExpensesByMonth, setVariableExpensesByMonth] = useState<Record<MonthKey, Entry[]>>({});
  const [communicationsByMonth, setCommunicationsByMonth] = useState<Record<MonthKey, Entry[]>>({});
  const [loansByMonth, setLoansByMonth] = useState<Record<MonthKey, Entry[]>>({});
  const [dailyByDate, setDailyByDate] = useState<Record<string, Entry[]>>({});
  const [dailyDate, setDailyDate] = useState<string>(todayStr);

  // クライアントでマウント後に localStorage から復元（hydration 後のみ実行）
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const refreshInFlightRef = useRef(false);

  const checkUserInFlightRef = useRef(false);

  const [bootStep, setBootStep] = useState<string>("init");
  const [bootError, setBootError] = useState<string | null>(null);

  const [cardDetail, setCardDetail] = useState<{ group: DetailGroup; monthKey: MonthKey } | null>(null);

  useEffect(() => {
    let initialScope: DataScope = "personal";
    setBootStep("read-localstorage");
    try {
      const savedScope = localStorage.getItem(STORAGE_KEY_SCOPE);
      if (savedScope === "personal" || savedScope === "group") initialScope = savedScope as DataScope;
    } catch {
      // ignore
    }
    setDataScope(initialScope);
    setGroupNavOpen(initialScope === "group");

    // 先にローカルデータを復元して画面を進める（同期/認証が遅い端末でも無限スピナーにしない）
    const data = normalizeStoredData(loadFromStorage(storageKeyForScope(initialScope)));
    setIncomeByMonth(data.incomeByMonth);
    setOtherIncomeByMonth(data.otherIncomeByMonth);
    setFixedExpensesByMonth(data.fixedExpensesByMonth);
    setVariableExpensesByMonth(data.variableExpensesByMonth);
    setCommunicationsByMonth(data.communicationsByMonth);
    setLoansByMonth(data.loansByMonth);
    setDailyByDate(data.dailyByDate);
    try {
      const savedView = localStorage.getItem(STORAGE_KEY_VIEW);
      if (savedView === "main" || savedView === "monthly" || savedView === "daily" || savedView === "settings") {
        setActiveView(savedView);
      }
    } catch {
      // ignore
    }
    setHydrated(true);

    const checkUser = async () => {
      if (checkUserInFlightRef.current) return;
      checkUserInFlightRef.current = true;
      try {
        setBootStep("auth-get-session");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setBootStep("auth-no-session");
          router.push("/login");
          return;
        }
        setUser(session.user);

        setBootStep("profile-load");
        const prof = await getOrCreateProfile(session.user.id);
        setProfile(prof);
        if (prof.household_id) {
          setBootStep("sync-from-supabase");
          const members = await getHouseholdMembers(prof.household_id);
          setHouseholdMembers(members);
          await syncFromSupabase(prof.household_id, initialScope);
        }

        setBootStep("ready");
      } catch (err: any) {
        setBootStep("error");
        setBootError(err?.message ?? String(err));
        console.error("Profile error:", err);
      } finally {
        checkUserInFlightRef.current = false;
      }
    };

    const t = window.setTimeout(() => {
      setBootStep("timeout");
      setBootError((prev) => prev ?? "初期化がタイムアウトしました。再読み込みしてください。");
    }, 15000);

    void checkUser().finally(() => {
      window.clearTimeout(t);
    });
  }, []);

  const syncFromSupabase = async (householdId: string, targetScope?: DataScope) => {
    if (!householdId) return;
    const currentScope = targetScope || dataScope;
    setSyncing(true);
    try {
      // セッションチェック
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn("No session found during sync");
        return;
      }

      // まず全世帯メンバーの共有設定を取得
      const members = await getHouseholdMembers(householdId);
      setHouseholdMembers(members);

      // 項目を単純取得（外部キーエラー回避のため結合はしない）
      const { data, error } = await supabase
        .from("entries")
        .select("*")
        .eq("household_id", householdId);
      
      if (error) throw error;
      
      const newData: KakeiboStoredData = getEmptyData();
      (data ?? []).forEach((e: any) => {
        // スコープに応じたフィルタリング
        if (currentScope === "personal") {
          // 個人モード：自分の個人項目のみ表示
          if (e.origin_scope !== "personal" || e.created_by !== session.user.id) return;
        } else {
          // グループモード：
          // 1. origin_scope が 'group' なら常に表示
          // 2. origin_scope が 'personal' (または未定義) なら作成者の共有設定が ON の場合のみ表示
          const creatorProfile = members.find(m => m.id === e.created_by);
          const isShared = e.origin_scope === 'group' || creatorProfile?.share_with_group === true;
          if (!isShared) return;
        }

        const entry: Entry = normalizeEntry({
          id: e.id,
          name: e.name,
          amount: e.amount,
          note: e.note || "",
          date: e.date,
          done: e.done,
          created_by: e.created_by,
          origin_scope: e.origin_scope,
        });

        if (e.group_key === "daily") {
          if (!newData.dailyByDate[e.date]) newData.dailyByDate[e.date] = [];
          newData.dailyByDate[e.date].push(entry);
        } else {
          const m = e.date.slice(0, 7);
          const key = `${e.group_key}ByMonth` as keyof KakeiboStoredData;
          if (newData[key]) {
            const monthData = newData[key] as Record<MonthKey, Entry[]>;
            if (!monthData[m]) monthData[m] = [];
            monthData[m].push(entry);
          }
        }
      });

      setIncomeByMonth(newData.incomeByMonth);
      setOtherIncomeByMonth(newData.otherIncomeByMonth);
      setFixedExpensesByMonth(newData.fixedExpensesByMonth);
      setVariableExpensesByMonth(newData.variableExpensesByMonth);
      setCommunicationsByMonth(newData.communicationsByMonth);
      setLoansByMonth(newData.loansByMonth);
      setDailyByDate(newData.dailyByDate);
    } catch (err) {
      if (err instanceof TypeError && err.message === "Failed to fetch") {
        console.error("Supabase connection failed (Failed to fetch). Please check your internet connection.");
      } else {
        console.error("Sync error:", err);
      }
    } finally {
      setSyncing(false);
    }
  };

  const refreshAll = useCallback(async () => {
    if (!profile?.household_id || !user?.id) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await syncFromSupabase(profile.household_id, dataScope);
      const members = await getHouseholdMembers(profile.household_id);
      setHouseholdMembers(members);
      // プロフィール自体も最新化（共有設定など）
      const { data: prof, error } = await supabase
        .from("profiles")
        .select("*, households(*)")
        .eq("id", user.id)
        .single();
      if (!error && prof) setProfile(prof);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [profile?.household_id, user?.id]);

  const syncToSupabase = async (groupKey: string, entry: Entry) => {
    if (!profile?.household_id || isLocked(entry)) return;
    
    // UUID かどうかチェック (Local で生成した UUID か DB からきた UUID なら UUID)
    // rollup などの特殊 ID は除外
    if (typeof entry.id === 'string' && (entry.id.startsWith('daily-rollup') || entry.id.startsWith('comm-rollup'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from("entries")
        .upsert({
          id: typeof entry.id === 'string' && entry.id.length > 20 ? entry.id : undefined, // UUID のみ渡す
          household_id: profile.household_id,
          group_key: groupKey,
          name: entry.name,
          amount: entry.amount,
          note: entry.note || "",
          date: entry.date,
          done: entry.done,
          created_by: entry.created_by || user?.id,
          origin_scope: entry.origin_scope || dataScope,
        });
      if (error) throw error;
    } catch (err) {
      console.error("Sync to DB error:", err);
    }
  };

  const removeFromSupabase = async (entryId: string | number) => {
    if (typeof entryId === 'number' || (typeof entryId === 'string' && entryId.length < 20)) return;
    try {
      const { error } = await supabase
        .from("entries")
        .delete()
        .eq("id", entryId);
      if (error) throw error;
    } catch (err) {
      console.error("Delete from DB error:", err);
    }
  };

  const isLocked = (e: Entry) => e.locked === true || typeof e.lockedKey === "string";

  // 自動保存（hydration 後かつ変更時のみ）
  useEffect(() => {
    if (!hydrated) return;
    const data: KakeiboStoredData = {
      incomeByMonth,
      otherIncomeByMonth,
      fixedExpensesByMonth,
      variableExpensesByMonth,
      communicationsByMonth,
      loansByMonth,
      dailyByDate,
    };
    try {
      localStorage.setItem(storageKeyForScope(dataScope), JSON.stringify(data));
    } catch {
      // quota or private mode
    }
  }, [
    hydrated,
    dataScope,
    incomeByMonth,
    otherIncomeByMonth,
    fixedExpensesByMonth,
    variableExpensesByMonth,
    communicationsByMonth,
    loansByMonth,
    dailyByDate,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_SCOPE, dataScope);
    } catch {
      // ignore
    }
  }, [hydrated, dataScope]);

  // 表示タブ（メイン / 月ごとの内訳）を保存
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_VIEW, activeView);
    } catch {
      // ignore
    }
  }, [hydrated, activeView]);

  // 現在選択中の月の配列を取り出すヘルパー
  const income = incomeByMonth[month] ?? [];
  const otherIncome = otherIncomeByMonth[month] ?? [];
  const fixedExpenses = fixedExpensesByMonth[month] ?? [];
  const variableExpenses = variableExpensesByMonth[month] ?? [];
  const communications = communicationsByMonth[month] ?? [];
  const loans = loansByMonth[month] ?? [];

  const [detail, setDetail] = useState<{ group: DetailGroup; monthKey: MonthKey; entryId: string | number } | null>(null);
  const [dailyDetail, setDailyDetail] = useState<{ date: string; entryId: string | number } | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState<"income" | "expenses" | null>(null);
  const [dailySummaryOpen, setDailySummaryOpen] = useState(false);
  const [dailyTotalsOpen, setDailyTotalsOpen] = useState(false);

  const updateGroupEntriesAtMonth = useCallback(
    (group: DetailGroup, targetMonth: MonthKey, updater: (prevEntries: Entry[]) => Entry[]) => {
      const groupMap: Record<DetailGroup, [Record<MonthKey, Entry[]>, (v: Record<MonthKey, Entry[]>) => void]> = {
        income: [incomeByMonth, setIncomeByMonth],
        otherIncome: [otherIncomeByMonth, setOtherIncomeByMonth],
        fixedExpenses: [fixedExpensesByMonth, setFixedExpensesByMonth],
        variableExpenses: [variableExpensesByMonth, setVariableExpensesByMonth],
        communications: [communicationsByMonth, setCommunicationsByMonth],
        loans: [loansByMonth, setLoansByMonth],
      };

      const [prev, set] = groupMap[group];
      const currentEntries = prev[targetMonth] ?? [];
      const nextEntries = updater(currentEntries);
      
      set({ ...prev, [targetMonth]: nextEntries });
      
      nextEntries.forEach(e => syncToSupabase(group, e));
      if (nextEntries.length < currentEntries.length) {
        const deleted = currentEntries.filter(ce => !nextEntries.some(ne => ne.id === ce.id));
        deleted.forEach(d => removeFromSupabase(d.id));
      }
    },
    [
      incomeByMonth,
      otherIncomeByMonth,
      fixedExpensesByMonth,
      variableExpensesByMonth,
      communicationsByMonth,
      loansByMonth,
      syncToSupabase,
      removeFromSupabase,
    ],
  );

  const updateDailyEntries = useCallback(
    (targetDate: string, updater: (prevEntries: Entry[]) => Entry[]) => {
      const currentEntries = dailyByDate[targetDate] ?? [];
      const nextEntries = updater(currentEntries);
      
      setDailyByDate({ ...dailyByDate, [targetDate]: nextEntries });
      
      nextEntries.forEach(e => syncToSupabase("daily", e));
      if (nextEntries.length < currentEntries.length) {
        const deleted = currentEntries.filter(ce => !nextEntries.some(ne => ne.id === ce.id));
        deleted.forEach(d => removeFromSupabase(d.id));
      }
    },
    [dailyByDate, syncToSupabase, removeFromSupabase],
  );

  const updateGroupEntries = useCallback(
    (group: DetailGroup, updater: (prevEntries: Entry[]) => Entry[]) => {
      updateGroupEntriesAtMonth(group, month, updater);
    },
    [month, updateGroupEntriesAtMonth],
  );

  const entriesByGroupAtMonth = (group: DetailGroup, targetMonth: MonthKey): Entry[] => {
    if (group === "income") return incomeByMonth[targetMonth] ?? [];
    if (group === "otherIncome") return otherIncomeByMonth[targetMonth] ?? [];
    if (group === "fixedExpenses") return fixedExpensesByMonth[targetMonth] ?? [];
    if (group === "variableExpenses") return variableExpensesByMonth[targetMonth] ?? [];
    if (group === "communications") return communicationsByMonth[targetMonth] ?? [];
    return loansByMonth[targetMonth] ?? [];
  };

  const entriesByGroup = (group: DetailGroup): Entry[] => {
    if (group === "income") return income;
    if (group === "otherIncome") return otherIncome;
    if (group === "fixedExpenses") return fixedExpenses;
    if (group === "variableExpenses") return variableExpenses;
    if (group === "communications") return communications;
    return loans;
  };

  const detailEntry = detail
    ? entriesByGroupAtMonth(detail.group, detail.monthKey).find((e) => e.id === detail.entryId)
    : undefined;

  const dailyDetailEntry = dailyDetail
    ? (dailyByDate[dailyDetail.date] ?? []).find((e) => e.id === dailyDetail.entryId)
    : undefined;

  const incomeTotalDone = useMemo(
    () => sumAmountDone(income) + sumAmountDone(otherIncome),
    [income, otherIncome],
  );

  const expensesTotalDone = useMemo(
    () =>
      sumAmountDone(fixedExpenses) +
      sumAmountDone(variableExpenses) +
      sumAmountDone(loans),
    [fixedExpenses, variableExpenses, loans],
  );

  // サマリー計算（完了チェックが入っている項目のみ）
  const totalIncome = useMemo(
    () =>
      sumAmountDone(income) +
      sumAmountDone(otherIncome),
    [income, otherIncome],
  );

  const totalExpenses = useMemo(
    () =>
      sumAmountDone(fixedExpenses) +
      sumAmountDone(variableExpenses) +
      sumAmountDone(loans),
    [fixedExpenses, variableExpenses, loans],
  );

  const monthlyBalance = useMemo(
    () => totalIncome - totalExpenses,
    [totalIncome, totalExpenses],
  );

  // とりあえず固定値（要件より）
  const cumulativeBalance = 500000;

  const monthlyGraphItems = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => monthKeyOffset(currentMonthKey, i - 5));
    return months.map((m) => {
      const incomeTotal = sumAmountDone(incomeByMonth[m] ?? []) + sumAmountDone(otherIncomeByMonth[m] ?? []);
      const expensesTotal =
        sumAmountDone(fixedExpensesByMonth[m] ?? []) +
        sumAmountDone(variableExpensesByMonth[m] ?? []) +
        sumAmountDone(loansByMonth[m] ?? []);
      return {
        monthKey: m,
        label: formatMonthShort(m),
        income: incomeTotal,
        expenses: expensesTotal,
        balance: incomeTotal - expensesTotal,
      };
    });
  }, [
    incomeByMonth,
    otherIncomeByMonth,
    fixedExpensesByMonth,
    variableExpensesByMonth,
    loansByMonth,
  ]);

  const dailyEntries = dailyByDate[dailyDate] ?? [];
  const dailyExpensesTotalDone = useMemo(() => sumAmountDone(dailyEntries), [dailyEntries]);

  const dailyViewMonthKey = useMemo(() => dailyDate.slice(0, 7), [dailyDate]);
  const dailyMonthTotals = useMemo(() => {
    const days = Object.keys(dailyByDate)
      .filter((d) => d.startsWith(`${dailyViewMonthKey}-`))
      .sort();
    const rows = days.map((d) => {
      const list = dailyByDate[d] ?? [];
      return { date: d, total: sumAmountDone(list), count: list.length };
    });
    const monthTotal = rows.reduce((s, r) => s + r.total, 0);
    return { rows, monthTotal };
  }, [dailyByDate, dailyViewMonthKey]);
  const dailyViewIncomeTotalDone = useMemo(
    () => sumAmountDone(incomeByMonth[dailyViewMonthKey] ?? []) + sumAmountDone(otherIncomeByMonth[dailyViewMonthKey] ?? []),
    [dailyViewMonthKey, incomeByMonth, otherIncomeByMonth],
  );
  const dailyViewExpensesTotalDone = useMemo(
    () =>
      sumAmountDone(fixedExpensesByMonth[dailyViewMonthKey] ?? []) +
      sumAmountDone(variableExpensesByMonth[dailyViewMonthKey] ?? []) +
      sumAmountDone(loansByMonth[dailyViewMonthKey] ?? []),
    [dailyViewMonthKey, fixedExpensesByMonth, variableExpensesByMonth, loansByMonth],
  );
  const dailyViewMonthlyBalance = useMemo(
    () => dailyViewIncomeTotalDone - dailyViewExpensesTotalDone,
    [dailyViewIncomeTotalDone, dailyViewExpensesTotalDone],
  );

  const upsertLockedEntry = useCallback((prev: Entry[], lockedEntry: Entry): Entry[] => {
    const idx = prev.findIndex((e) => e.lockedKey === lockedEntry.lockedKey);
    if (idx === -1) return [lockedEntry, ...prev];
    const existing = prev[idx];
    const same =
      existing.name === lockedEntry.name &&
      existing.amount === lockedEntry.amount &&
      existing.note === lockedEntry.note &&
      existing.date === lockedEntry.date &&
      existing.done === lockedEntry.done &&
      existing.locked === lockedEntry.locked &&
      existing.lockedKey === lockedEntry.lockedKey;
    if (same && idx === 0) return prev;
    const next = [...prev];
    next.splice(idx, 1);
    next.unshift(lockedEntry);
    return next;
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const monthKeysFromDaily = new Set(Object.keys(dailyByDate).map((d) => d.slice(0, 7)));
    setVariableExpensesByMonth((prev) => {
      const keysWithLocked = new Set<string>();
      for (const [m, list] of Object.entries(prev)) {
        if (list.some((e) => e.lockedKey === "daily_rollup")) keysWithLocked.add(m);
      }
      const targetMonths = new Set<string>([...monthKeysFromDaily, ...keysWithLocked, month]);
      let changed = false;
      const next: Record<string, Entry[]> = { ...prev };

      for (const m of targetMonths) {
        const dailyDates = Object.keys(dailyByDate).filter((d) => d.startsWith(`${m}-`)).sort();
        const perDate = dailyDates.map((d) => ({
          date: d,
          total: sumAmountDone(dailyByDate[d] ?? []),
          count: (dailyByDate[d] ?? []).length,
        }));
        const monthTotal = perDate.reduce((s, x) => s + x.total, 0);
        const note = perDate
          .filter((x) => x.count > 0 || x.total > 0)
          .map((x) => `${x.date}: ${formatCurrency(x.total)}（${x.count}件）`)
          .join("\n");

        const base = prev[m] ?? [];
        const hasAny = note.length > 0 || monthTotal > 0;
        if (!hasAny) {
          if (base.some((e) => e.lockedKey === "daily_rollup")) {
            next[m] = base.filter((e) => e.lockedKey !== "daily_rollup");
            changed = true;
          }
          continue;
        }

        const lockedEntry: Entry = {
          id: `daily-rollup-${m}`,
          name: "日別支出",
          amount: monthTotal,
          note,
          date: `${m}-01`,
          done: true,
          locked: true,
          lockedKey: "daily_rollup",
        };

        const updated = upsertLockedEntry(base, lockedEntry);
        if (updated !== base) {
          next[m] = updated;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [dailyByDate, hydrated, month, upsertLockedEntry]);

  useEffect(() => {
    if (!hydrated) return;
    setFixedExpensesByMonth((prev) => {
      const monthsFromComm = new Set(Object.keys(communicationsByMonth));
      const keysWithLocked = new Set<string>();
      for (const [m, list] of Object.entries(prev)) {
        if (list.some((e) => e.lockedKey === "communications_rollup")) keysWithLocked.add(m);
      }
      const targetMonths = new Set<string>([...monthsFromComm, ...keysWithLocked, month]);
      let changed = false;
      const next: Record<string, Entry[]> = { ...prev };

      for (const m of targetMonths) {
        const total = sumAmountDone(communicationsByMonth[m] ?? []);
        const base = prev[m] ?? [];
        const hasAny = total > 0 || (communicationsByMonth[m] ?? []).length > 0;
        if (!hasAny) {
          if (base.some((e) => e.lockedKey === "communications_rollup")) {
            next[m] = base.filter((e) => e.lockedKey !== "communications_rollup");
            changed = true;
          }
          continue;
        }

        const lockedEntry: Entry = {
          id: `comm-rollup-${m}`,
          name: "通信料金",
          amount: total,
          note: "詳細管理グループ（通信料金）の合計",
          date: `${m}-01`,
          done: true,
          locked: true,
          lockedKey: "communications_rollup",
        };

        const updated = upsertLockedEntry(base, lockedEntry);
        if (updated !== base) {
          next[m] = updated;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [communicationsByMonth, hydrated, month, upsertLockedEntry]);

  const exportData = useCallback((): KakeiboStoredData => ({
    incomeByMonth,
    otherIncomeByMonth,
    fixedExpensesByMonth,
    variableExpensesByMonth,
    communicationsByMonth,
    loansByMonth,
    dailyByDate,
  }), [
    incomeByMonth,
    otherIncomeByMonth,
    fixedExpensesByMonth,
    variableExpensesByMonth,
    communicationsByMonth,
    loansByMonth,
    dailyByDate,
  ]);

  const downloadJSON = useCallback(() => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kakeibo-${currentMonthKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportData]);

  const downloadCSV = useCallback(() => {
    const categories: { key: keyof KakeiboStoredData; label: string }[] = [
      { key: "incomeByMonth", label: "収入" },
      { key: "otherIncomeByMonth", label: "その他収入" },
      { key: "fixedExpensesByMonth", label: "固定支出" },
      { key: "variableExpensesByMonth", label: "変動支出" },
      { key: "communicationsByMonth", label: "通信料金" },
      { key: "loansByMonth", label: "借金・ローン" },
    ];
    const rows: string[][] = [["カテゴリ", "月", "項目名", "金額", "備考", "日付", "完了"]];
    const data = exportData();
    for (const { key, label } of categories) {
      const byMonth = data[key];
      for (const [monthKey, entries] of Object.entries(byMonth)) {
        for (const e of entries) {
          rows.push([
            label,
            monthKey,
            e.name,
            String(e.amount),
            e.note,
            e.date,
            e.done ? "済" : "",
          ]);
        }
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kakeibo-${currentMonthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportData]);

  const loadFromFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        if (file.name.endsWith(".json")) {
          const data = JSON.parse(text) as KakeiboStoredData;
          setIncomeByMonth(data.incomeByMonth ?? {});
          setOtherIncomeByMonth(data.otherIncomeByMonth ?? {});
          setFixedExpensesByMonth(data.fixedExpensesByMonth ?? {});
          setVariableExpensesByMonth(data.variableExpensesByMonth ?? {});
          setCommunicationsByMonth(data.communicationsByMonth ?? {});
          setLoansByMonth(data.loansByMonth ?? {});
          setDailyByDate(data.dailyByDate ?? {});
        } else if (file.name.endsWith(".csv")) {
          const lines = text.split(/\r?\n/).filter(Boolean);
          if (lines.length < 2) return;
          const parseRow = (line: string): string[] => {
            const out: string[] = [];
            let cur = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const c = line[i];
              if (c === '"') {
                inQuotes = !inQuotes;
              } else if ((c === "," && !inQuotes) || (c === "\n" && !inQuotes)) {
                out.push(cur);
                cur = "";
              } else {
                cur += c;
              }
            }
            out.push(cur);
            return out;
          };
          const empty: KakeiboStoredData = getEmptyData();
          const categoryToKey: Record<string, keyof KakeiboStoredData> = {
            収入: "incomeByMonth",
            "その他収入": "otherIncomeByMonth",
            固定支出: "fixedExpensesByMonth",
            変動支出: "variableExpensesByMonth",
            通信料金: "communicationsByMonth",
            "借金・ローン": "loansByMonth",
          };
          let id = 1;
          for (let i = 1; i < lines.length; i++) {
            const cells = parseRow(lines[i]);
            if (cells.length < 6) continue;
            const [catLabel, monthKey, name, amountStr, note, date, doneStr] = cells;
            const cat = (catLabel ?? "").trim().replace(/^\uFEFF/, "");
            const key = categoryToKey[cat];
            if (!key) continue;
            const entry: Entry = {
              id: id++,
              name: name ?? "",
              amount: Number(amountStr) || 0,
              note: note ?? "",
              date: date ?? todayStr,
              done: doneStr === "済",
            };
            const target = empty[key];
            if (!target[monthKey]) target[monthKey] = [];
            target[monthKey].push(entry);
          }
          setIncomeByMonth(empty.incomeByMonth);
          setOtherIncomeByMonth(empty.otherIncomeByMonth);
          setFixedExpensesByMonth(empty.fixedExpensesByMonth);
          setVariableExpensesByMonth(empty.variableExpensesByMonth);
          setCommunicationsByMonth(empty.communicationsByMonth);
          setLoansByMonth(empty.loansByMonth);
          setDailyByDate(empty.dailyByDate);
        }
      } catch (e) {
        window.alert("ファイルの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6">
        <RefreshCw className="h-8 w-8 animate-spin text-sky-500" />
        <div className="text-xs font-bold text-slate-500">起動中: {bootStep}</div>
        {bootError && <div className="text-xs font-bold text-rose-600">{bootError}</div>}
      </div>
    );
  }

  return (
    <main className={`min-h-screen bg-gray-50 text-slate-900 transition-all duration-500 ${
      dataScope === "group" ? "ring-[8px] ring-inset ring-slate-900/20" : ""
    }`}>
      <GroupTopNav
        isOpen={groupNavOpen && dataScope === "group"}
        householdName={profile?.households?.name || "グループ"}
        members={householdMembers}
        activeView={activeView}
        onChangeView={setActiveView}
        onClose={() => {
          void switchScope("personal");
        }}
        onSwitchPersonal={() => {
          void switchScope("personal");
        }}
      />
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.08}
        onDragEnd={(_, info) => {
          handleSwipeScopeSwitch(info.offset.x, info.offset.y);
        }}
        className={`mx-auto flex w-full max-w-screen-2xl flex-col gap-8 px-4 pb-28 lg:px-8 ${
          groupNavOpen && dataScope === "group" ? "pt-24" : "pt-8"
        }`}
      >
        {/* ヘッダー */}
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 md:text-3xl">
                Kakeibo
              </h1>
              {dataScope === "group" ? (
                <Badge variant="solid" className="bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-sm ring-1 ring-slate-900/10">
                  Group Mode
                </Badge>
              ) : (
                <Badge variant="soft" className="bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400 shadow-sm ring-1 ring-slate-200">
                  Personal
                </Badge>
              )}
            </div>
            
            {activeView === "monthly" && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="前の月"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="relative group flex items-center px-3">
                    <span className="text-sm font-bold text-slate-700 min-w-[90px] text-center">
                      {displayMonthLabel}
                    </span>
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      title="クリックして月を選択"
                    />
                    <CalendarDays className="ml-1 h-4 w-4 text-slate-300 transition group-hover:text-slate-500" />
                  </div>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="次の月"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                <AnimatePresence>
                  {month !== currentMonthKey && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      type="button"
                      onClick={setTodayMonth}
                      className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-600 transition hover:bg-sky-100 active:scale-95"
                    >
                      今月に戻る
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            )}

            {activeView === "daily" && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => shiftDailyDay(-1)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="前の日"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="relative group flex items-center px-3">
                    <span className="text-sm font-bold text-slate-700 min-w-[90px] text-center tabular-nums">
                      {formatJapaneseMonthDay(dailyDate)}
                    </span>
                    <input
                      type="date"
                      value={dailyDate}
                      onChange={(e) => setDailyDate(e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      title="クリックして日付を選択"
                    />
                    <CalendarDays className="ml-1 h-4 w-4 text-slate-300 transition group-hover:text-slate-500" />
                  </div>
                  <button
                    type="button"
                    onClick={() => shiftDailyDay(1)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="次の日"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                <AnimatePresence>
                  {dailyDate !== todayStr && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      type="button"
                      onClick={() => setDailyDate(todayStr)}
                      className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-600 transition hover:bg-sky-100 active:scale-95"
                    >
                      今日に戻る
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </header>

        {activeView === "monthly" && (
          <motion.section 
            variants={{
              show: { transition: { staggerChildren: 0.1 } }
            }}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4"
          >
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
              <SummaryCard
                icon={ArrowDownCircle}
                title="収入合計"
                value={totalIncome}
                accentClass="border-emerald-200 bg-emerald-50 text-emerald-900"
                onClick={() => setSummaryOpen("income")}
              />
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
              <SummaryCard
                icon={ArrowUpCircle}
                title="支出合計"
                value={totalExpenses}
                accentClass="border-rose-200 bg-rose-50 text-rose-900"
                onClick={() => setSummaryOpen("expenses")}
              />
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
              <SummaryCard
                icon={Wallet}
                title="今月の残金"
                value={monthlyBalance}
                accentClass="border-sky-200 bg-sky-50 text-sky-900"
              />
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
              <SummaryCard
                icon={PiggyBank}
                title="累計残金（参考）"
                value={cumulativeBalance}
                accentClass="border-indigo-200 bg-indigo-50 text-indigo-900"
                displayOverride="--"
              />
            </motion.div>
          </motion.section>
        )}

        <AnimatePresence mode="wait">
          {activeView === "main" ? (
            <motion.section 
              key="main"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex flex-col gap-4"
            >
              <SectionHeader
                title="月ごとのグラフ"
                description="直近6ヶ月の収入と支出の推移を表示します。"
              />
              <MonthlyGraph items={monthlyGraphItems} />
            </motion.section>
          ) : activeView === "monthly" ? (
            /* 入力・一覧セクション（タブ: 月ごとの内訳） */
            <motion.section 
              key="monthly"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col gap-6"
            >
              <SectionHeader
                title="収入グループ"
                description="毎月の収入とその他収入を管理します。"
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
                <EntryCard
                  title="収入（給料など）"
                  icon={ReceiptJapaneseYen}
                  color="income"
                  monthKey={month}
                  entries={income}
                  onOpenCard={() => setCardDetail({ group: "income", monthKey: month })}
                  onOpenDetail={(entryId) => setDetail({ group: "income", monthKey: month, entryId })}
                  onChangeEntries={(next) => updateGroupEntriesAtMonth("income", month, () => next)}
                  userId={user?.id}
                  members={householdMembers}
                  dataScope={dataScope}
                />
                <EntryCard
                  title="その他収入"
                  icon={Landmark}
                  color="income"
                  monthKey={month}
                  entries={otherIncome}
                  onOpenCard={() => setCardDetail({ group: "otherIncome", monthKey: month })}
                  onOpenDetail={(entryId) => setDetail({ group: "otherIncome", monthKey: month, entryId })}
                  onChangeEntries={(next) => updateGroupEntriesAtMonth("otherIncome", month, () => next)}
                  userId={user?.id}
                  members={householdMembers}
                  dataScope={dataScope}
                />
              </div>

              <SectionHeader
                title="支出グループ"
                description="固定費と変動費を分けて把握します。"
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
                <EntryCard
                  title="固定支出（家賃、光熱費、保険など）"
                  icon={Home}
                  color="expense"
                  monthKey={month}
                  entries={fixedExpenses}
                  onOpenCard={() => setCardDetail({ group: "fixedExpenses", monthKey: month })}
                  onOpenDetail={(entryId) => setDetail({ group: "fixedExpenses", monthKey: month, entryId })}
                  onChangeEntries={(next) => updateGroupEntriesAtMonth("fixedExpenses", month, () => next)}
                  userId={user?.id}
                  members={householdMembers}
                  dataScope={dataScope}
                />
                <EntryCard
                  title="変動支出（食費、日用品など）"
                  icon={Wallet}
                  color="expense"
                  monthKey={month}
                  entries={variableExpenses}
                  onOpenCard={() => setCardDetail({ group: "variableExpenses", monthKey: month })}
                  onOpenDetail={(entryId) => setDetail({ group: "variableExpenses", monthKey: month, entryId })}
                  onChangeEntries={(next) => updateGroupEntriesAtMonth("variableExpenses", month, () => next)}
                  userId={user?.id}
                  members={householdMembers}
                  dataScope={dataScope}
                />
              </div>

              <SectionHeader
                title="詳細管理グループ"
                description="通信費やローンなど、注視したい支出を個別管理します。"
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
                <EntryCard
                  title="通信料金（スマホ代、ネット代など）"
                  icon={Phone}
                  color="detail"
                  monthKey={month}
                  entries={communications}
                  hideCardTotal={true}
                  onOpenCard={() => setCardDetail({ group: "communications", monthKey: month })}
                  onOpenDetail={(entryId) => setDetail({ group: "communications", monthKey: month, entryId })}
                  onChangeEntries={(next) => updateGroupEntriesAtMonth("communications", month, () => next)}
                  userId={user?.id}
                  members={householdMembers}
                  dataScope={dataScope}
                />
                <EntryCard
                  title="借金・ローン"
                  icon={Landmark}
                  color="detail"
                  monthKey={month}
                  entries={loans}
                  onOpenCard={() => setCardDetail({ group: "loans", monthKey: month })}
                  onOpenDetail={(entryId) => setDetail({ group: "loans", monthKey: month, entryId })}
                  onChangeEntries={(next) => updateGroupEntriesAtMonth("loans", month, () => next)}
                  userId={user?.id}
                  members={householdMembers}
                  dataScope={dataScope}
                />
              </div>
            </motion.section>
          ) : activeView === "daily" ? (
            <motion.section
              key="daily"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col gap-6"
            >
              <motion.section
                variants={{
                  show: { transition: { staggerChildren: 0.1 } }
                }}
                initial="hidden"
                animate="show"
                className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3"
              >
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
                  <SummaryCard
                    icon={ArrowUpCircle}
                    title="今日の支出"
                    value={dailyExpensesTotalDone}
                    accentClass="border-rose-200 bg-rose-50 text-rose-900"
                    onClick={() => setDailySummaryOpen(true)}
                  />
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
                  <SummaryCard
                    icon={CalendarDays}
                    title="日別の合計"
                    value={dailyMonthTotals.monthTotal}
                    accentClass="border-rose-200 bg-rose-50 text-rose-900"
                    onClick={() => setDailyTotalsOpen(true)}
                  />
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
                  <SummaryCard
                    icon={Wallet}
                    title="今月の残金"
                    value={dailyViewMonthlyBalance}
                    accentClass="border-sky-200 bg-sky-50 text-sky-900"
                  />
                </motion.div>
              </motion.section>

              <DailyExpensePanel
                date={dailyDate}
                entries={dailyByDate[dailyDate] ?? []}
                onChangeEntries={(next: Entry[]) => updateDailyEntries(dailyDate, () => next)}
                onOpenDetail={(entryId) => setDailyDetail({ date: dailyDate, entryId })}
                userId={user?.id}
                members={householdMembers}
                dataScope={dataScope}
              />
            </motion.section>
          ) : (
            <motion.section
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col gap-6"
            >
              <SectionHeader
                title="設定"
                description="ユーザープロフィール、世帯管理、データの同期設定を行います。"
              />
              <Card>
                <CardContent className="flex flex-col gap-8">
                  {/* ユーザープロフィールセクション */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-2">
                      <User className="h-5 w-5 text-slate-700" />
                      <h3 className="text-sm font-bold text-slate-700">ユーザー設定</h3>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-2xl bg-slate-50">
                      <div className="relative group">
                        <div className="h-20 w-20 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden ring-2 ring-white shadow-sm">
                          {avatarPreview ? (
                            <img src={avatarPreview} alt="Preview" className="h-full w-full object-cover" />
                          ) : profile?.avatar_url ? (
                            <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
                          ) : (
                            <User className="h-10 w-10 text-slate-400" />
                          )}
                        </div>
                        {editingProfile && (
                          <label className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <Camera className="h-5 w-5 text-white" />
                            <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
                          </label>
                        )}
                      </div>

                      <div className="flex-1 space-y-3 w-full">
                        {!editingProfile ? (
                          <>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-lg font-bold text-slate-800">{profile?.full_name || "ユーザー"}</p>
                                  <Badge variant="soft" className={profile?.role === 'admin' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'}>
                                    {profile?.role === 'admin' ? '管理者' : '一般'}
                                  </Badge>
                                </div>
                                <p className="text-xs text-slate-400">{user?.email}</p>
                              </div>
                              <button
                                onClick={() => {
                                  setNewUsername(profile?.full_name || "");
                                  setNewShareWithGroup(profile?.share_with_group ?? true);
                                  setEditingProfile(true);
                                }}
                                className="text-xs font-bold text-sky-600 hover:text-sky-700"
                              >
                                編集する
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <Badge variant="soft" className={profile?.share_with_group !== false ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}>
                                {profile?.share_with_group !== false ? "共有ON" : "共有OFF"}
                              </Badge>
                              <span className="text-[10px] text-slate-400">グループに情報を共有</span>
                              {profile?.share_with_group !== false && (
                                <button
                                  onClick={syncAllToSupabase}
                                  disabled={syncing}
                                  className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 hover:text-sky-700 disabled:opacity-50"
                                >
                                  <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                                  今すぐ同期
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ユーザー名</label>
                              <input
                                type="text"
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                                placeholder="お名前"
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-sky-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">共有設定</label>
                              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 transition">
                                <Checkbox checked={newShareWithGroup} onChange={setNewShareWithGroup} />
                                <span className="text-slate-700">グループに情報を共有</span>
                              </label>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">アイコン（画像を選択）</label>
                              <label className="flex items-center gap-2 w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-500 cursor-pointer hover:bg-slate-50 transition">
                                <ImageIcon className="h-4 w-4" />
                                {avatarFile ? avatarFile.name : "画像ファイルを選択"}
                                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
                              </label>
                            </div>
                            {profile?.avatar_url && (
                              <button
                                type="button"
                                onClick={handleRemoveAvatar}
                                className="w-full rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 active:scale-95"
                              >
                                アイコンを削除（デフォルトに戻す）
                              </button>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={handleUpdateProfile}
                                className="flex-1 rounded-xl bg-slate-900 py-2 text-xs font-bold text-white transition active:scale-95"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => {
                                  setEditingProfile(false);
                                  setAvatarFile(null);
                                  setAvatarPreview(null);
                                }}
                                className="flex-1 rounded-xl bg-white border border-slate-200 py-2 text-xs font-bold text-slate-600 transition active:scale-95"
                              >
                                キャンセル
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <button
                        onClick={() => setIsChangingPassword(!isChangingPassword)}
                        className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                      >
                        <Key className="h-3.5 w-3.5" />
                        パスワードを変更する
                      </button>
                      
                      {isChangingPassword && (
                        <div className="flex gap-2 animate-in slide-in-from-top-2">
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="新しいパスワード"
                            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-sky-500"
                          />
                          <button
                            onClick={handleChangePassword}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-md transition active:scale-95"
                          >
                            変更
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 世帯管理セクション */}
                  <div className="space-y-4 pt-6 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-700" />
                      <h3 className="text-sm font-bold text-slate-700">世帯（ファミリー共有）</h3>
                    </div>
                    
                    {dataScope === "group" ? (
                      <>
                        <div className="rounded-2xl bg-slate-50 p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">現在の世帯</p>
                              <p className="text-sm font-bold text-slate-700">{profile?.households?.name || "未設定"}</p>
                            </div>
                            <button
                              onClick={copyHouseholdId}
                              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 transition"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              IDをコピー
                            </button>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">メンバー</p>
                            <div className="flex flex-col gap-2">
                              {householdMembers.map((m) => (
                                <div key={m.id} className="flex items-center justify-between p-2 rounded-xl bg-white ring-1 ring-slate-100">
                                  <div className="flex items-center gap-2">
                                    <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                                      {m.avatar_url ? (
                                        <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                                      ) : (
                                        <User className="h-4 w-4 text-slate-400" />
                                      )}
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-bold text-slate-700">{m.full_name || "名無しユーザー"}</span>
                                      <span className="text-[10px] text-slate-400">{m.role === 'admin' ? '管理者' : '一般メンバー'}</span>
                                    </div>
                                  </div>
                                  {profile?.role === 'admin' && m.id !== user?.id && m.role !== 'admin' && (
                                    <button
                                      type="button"
                                      onClick={() => openDeleteMember(m.id, m.full_name || m.id.slice(0, 8))}
                                      className="rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-[0.98]"
                                    >
                                      削除
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {profile?.role === 'admin' ? (
                          <div className="space-y-3">
                            <button
                              onClick={() => setIsCreatingSubAccount(!isCreatingSubAccount)}
                              className="flex items-center gap-2 text-xs font-bold text-sky-600 hover:text-sky-700"
                            >
                              <UserPlus2 className="h-3.5 w-3.5" />
                              家族用アカウントを新規作成する
                            </button>

                            {isCreatingSubAccount && (
                              <div className="p-4 rounded-2xl border border-sky-100 bg-sky-50/30 space-y-3 animate-in slide-in-from-top-2">
                                <p className="text-[11px] font-bold text-sky-700 uppercase tracking-wider">新規メンバー登録</p>
                                <input
                                  type="text"
                                  value={subDisplayName}
                                  onChange={(e) => setSubDisplayName(e.target.value)}
                                  placeholder="ユーザー名（例：お母さん）"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-sky-500"
                                />
                                <input
                                  type="text"
                                  value={subId}
                                  onChange={(e) => setSubId(e.target.value)}
                                  placeholder="ログインID（英数字）"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-sky-500"
                                />
                                <input
                                  type="password"
                                  value={subPassword}
                                  onChange={(e) => setSubPassword(e.target.value)}
                                  placeholder="パスワード"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-sky-500"
                                />
                                <button
                                  onClick={handleCreateSubAccount}
                                  className="w-full rounded-xl bg-sky-600 py-2.5 text-xs font-bold text-white shadow-md transition active:scale-95"
                                >
                                  アカウントを発行する
                                </button>
                                <p className="text-[10px] text-slate-400">※作成後、このログインIDとパスワードでログインできます。</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-bold text-slate-600">他の世帯に参加する</p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={joinId}
                                onChange={(e) => setJoinId(e.target.value)}
                                placeholder="世帯IDを入力"
                                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none transition focus:border-sky-500"
                              />
                              <button
                                onClick={handleJoin}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-md transition active:scale-95"
                              >
                                参加
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-400">※参加すると現在のデータは閲覧できなくなります。</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
                        <p className="text-xs font-bold text-slate-700">現在は個人モードです。</p>
                        <button
                          type="button"
                          onClick={() => void switchScope("group")}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition active:scale-95"
                        >
                          <Users className="h-4 w-4" />
                          グループを開く（共有）
                        </button>
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-slate-600">世帯IDで参加する</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={joinId}
                              onChange={(e) => setJoinId(e.target.value)}
                              placeholder="世帯IDを入力"
                              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none transition focus:border-sky-500"
                            />
                            <button
                              onClick={handleJoin}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-md transition active:scale-95"
                            >
                              参加
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* データ同期セクション */}
                  <div className="pt-6 border-t border-slate-100 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-slate-700" />
                        <span className="text-sm font-bold text-slate-700">データ保護・同期</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {syncing && <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-500" />}
                        <Badge variant="soft" className="text-slate-600 bg-slate-50">
                          {dataScope === "group" ? "グループ（手動同期）" : "個人（ローカル保存）"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {dataScope === "group" && (
                        <button
                          type="button"
                          onClick={refreshAll}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 md:text-sm"
                        >
                          <RefreshCw className="h-4 w-4" />
                          最新を取得
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={downloadJSON}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 md:text-sm"
                      >
                        <Download className="h-4 w-4" />
                        JSONで保存
                      </button>
                      <button
                        type="button"
                        onClick={downloadCSV}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 md:text-sm"
                      >
                        <Download className="h-4 w-4" />
                        CSVで保存
                      </button>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 md:text-sm">
                        <Upload className="h-4 w-4" />
                        ファイルから読み込み
                        <input
                          type="file"
                          accept=".json,.csv"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              loadFromFile(f);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {profile?.role === "admin" && (
                    <div className="pt-6 border-t border-slate-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Trash2 className="h-5 w-5 text-rose-600" />
                          <span className="text-sm font-bold text-slate-700">管理者メニュー</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={openAdminDanger}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 active:scale-[0.98]"
                      >
                        <Trash2 className="h-4 w-4" />
                        全てのデータを消去
                      </button>
                      <p className="text-[10px] text-slate-400">※この操作は取り消せません。世帯の全入力データを削除します。</p>
                    </div>
                  )}

                  {/* ログアウト */}
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-100 active:scale-[0.98]"
                    >
                      <LogOutIcon className="h-4 w-4" />
                      ログアウト
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.section>
          )}
        </AnimatePresence>
      </motion.div>

      <BottomNav
        activeView={activeView}
        dataScope={dataScope}
        onChangeView={setActiveView}
        onPressShare={() => {
          if (dataScope !== "group") {
            void switchScope("group");
          } else {
            void switchScope("personal");
          }
        }}
      />

      <QuickAddModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onSelect={(group) => {
          const newId = generateUUID();
          const newEntry: Entry = {
            id: newId,
            name: "",
            amount: 0,
            note: "",
            date: `${month}-01`,
            done: true,
            created_by: user?.id,
            origin_scope: dataScope,
          };
          updateGroupEntriesAtMonth(group, month, (prev) => [...prev, newEntry]);
          setQuickAddOpen(false);
          setDetail({ group, monthKey: month, entryId: newId });
        }}
      />

      {detail && detailEntry && (
        <DetailModal
          isOpen={true}
          onClose={() => setDetail(null)}
          entry={detailEntry}
          onSave={(field, value) => {
            if (isLocked(detailEntry)) return;
            updateGroupEntriesAtMonth(detail.group, detail.monthKey, (prev) =>
              prev.map((e) => (e.id === detail.entryId ? { ...e, [field]: value as never } : e)),
            );
          }}
          onDelete={() => {
            if (isLocked(detailEntry)) return;
            updateGroupEntriesAtMonth(detail.group, detail.monthKey, (prev) => prev.filter((e) => e.id !== detail.entryId));
            setDetail(null);
          }}
          userId={user?.id}
          members={householdMembers}
        />
      )}

      {dailyDetail && dailyDetailEntry && (
        <DetailModal
          isOpen={true}
          onClose={() => setDailyDetail(null)}
          entry={{ ...dailyDetailEntry, date: dailyDetail.date }}
          disableDate={true}
          onSave={(field, value) => {
            if (field === "date") return;
            updateDailyEntries(dailyDetail.date, (prev) => 
              prev.map((e) => e.id === dailyDetail.entryId ? { ...e, [field]: value as never } : e)
            );
          }}
          onDelete={() => {
            updateDailyEntries(dailyDetail.date, (prev) => 
              prev.filter((e) => e.id !== dailyDetail.entryId)
            );
            setDailyDetail(null);
          }}
          userId={user?.id}
          members={householdMembers}
        />
      )}

      <DailySummaryModal
        isOpen={dailySummaryOpen}
        onClose={() => setDailySummaryOpen(false)}
        dateLabel={formatJapaneseMonthDay(dailyDate)}
        totalAmount={dailyExpensesTotalDone}
        entries={dailyEntries}
        onOpenEntry={(entryId) => setDailyDetail({ date: dailyDate, entryId })}
      />

      <DailyTotalsModal
        isOpen={dailyTotalsOpen}
        onClose={() => setDailyTotalsOpen(false)}
        monthLabel={`${dailyViewMonthKey.slice(0, 4)}年 ${parseInt(dailyViewMonthKey.slice(5, 7), 10)}月`}
        monthKey={dailyViewMonthKey}
        monthTotal={dailyMonthTotals.monthTotal}
        rows={dailyMonthTotals.rows}
        selectedDate={dailyDate}
        onSelectDate={(d) => {
          setDailyDate(d);
          setDailyTotalsOpen(false);
        }}
      />

      <AdminDangerModal
        isOpen={adminDangerOpen}
        busy={adminDangerBusy}
        isDeletingMember={deleteMemberTarget !== null}
        targetLabel={deleteMemberTarget?.label ?? ""}
        password={adminDangerPassword}
        checked={adminDangerChecked}
        onChangePassword={setAdminDangerPassword}
        onChangeChecked={setAdminDangerChecked}
        onClose={closeAdminDanger}
        onRun={runAdminDanger}
      />

      <SummaryModal
        isOpen={summaryOpen !== null}
        onClose={() => setSummaryOpen(null)}
        onOpenEntry={(group, entryId) => setDetail({ group, monthKey: month, entryId })}
        title={summaryOpen === "income" ? "収入" : "支出"}
        monthLabel={displayMonthLabel}
        totalAmount={summaryOpen === "income" ? incomeTotalDone : expensesTotalDone}
        breakdown={
          summaryOpen === "income"
            ? [
                { label: "収入", value: sumAmountDone(income), colorClass: "bg-emerald-500" },
                { label: "その他収入", value: sumAmountDone(otherIncome), colorClass: "bg-emerald-300" },
              ]
            : [
                { label: "固定支出", value: sumAmountDone(fixedExpenses), colorClass: "bg-rose-500" },
                { label: "変動支出", value: sumAmountDone(variableExpenses), colorClass: "bg-rose-300" },
                { label: "借金・ローン", value: sumAmountDone(loans), colorClass: "bg-rose-100" },
              ]
        }
        entries={
          summaryOpen === "income"
            ? [
                ...income.map((e) => ({ ...e, groupLabel: "収入", groupKey: "income" as const })),
                ...otherIncome.map((e) => ({ ...e, groupLabel: "その他収入", groupKey: "otherIncome" as const })),
              ]
            : [
                ...fixedExpenses.map((e) => ({ ...e, groupLabel: "固定支出", groupKey: "fixedExpenses" as const })),
                ...variableExpenses.map((e) => ({ ...e, groupLabel: "変動支出", groupKey: "variableExpenses" as const })),
                ...loans.map((e) => ({ ...e, groupLabel: "借金・ローン", groupKey: "loans" as const })),
              ]
        }
      />

      {cardDetail && (
        <CardDetailModal
          isOpen={!!cardDetail}
          group={cardDetail.group}
          monthKey={cardDetail.monthKey}
          entries={entriesByGroupAtMonth(cardDetail.group, cardDetail.monthKey)}
          onClose={() => setCardDetail(null)}
        />
      )}
    </main>
  );
}

function CardDetailModal({
  isOpen,
  group,
  monthKey,
  entries,
  onClose,
}: {
  isOpen: boolean;
  group: DetailGroup;
  monthKey: MonthKey;
  entries: Entry[];
  onClose: () => void;
}) {
  if (!isOpen) return null;

  const max = Math.max(1, ...entries.map((e) => Math.abs(Number(e.amount) || 0)));
  const nextMonthKey = monthKeyOffset(monthKey, 1);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900">カード詳細</div>
            <div className="text-[11px] font-bold text-slate-400">{monthKey} → {nextMonthKey}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto px-5 py-4 space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-black text-slate-700">グラフ（簡易）</div>
            <div className="space-y-2">
              {entries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-[11px] font-bold text-slate-400">
                  項目がありません
                </div>
              ) : (
                entries.slice(0, 12).map((e) => {
                  const w = `${Math.round((Math.abs(Number(e.amount) || 0) / max) * 100)}%`;
                  return (
                    <div key={String(e.id)} className="flex items-center gap-3">
                      <div className="w-28 truncate text-[11px] font-bold text-slate-600">{e.name || "未設定"}</div>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-2 rounded-full bg-slate-900" style={{ width: w }} />
                        </div>
                      </div>
                      <div className="w-24 text-right text-[11px] font-black text-slate-700 tabular-nums">{formatCurrency(e.amount)}</div>
                    </div>
                  );
                })
              )}
            </div>
            {entries.length > 12 && (
              <div className="text-[10px] font-bold text-slate-400">※グラフは上位12件のみ表示</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- ユーティリティ ---------- */

function sumAmount(entries: Entry[]) {
  return entries.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0);
}

/** 完了チェックが入っている項目のみ合計（サマリー用） */
function sumAmountDone(entries: Entry[]) {
  return entries.reduce(
    (sum, e) => sum + (e.done && Number.isFinite(e.amount) ? e.amount : 0),
    0
  );
}

function monthKeyOffset(base: MonthKey, offset: number): MonthKey {
  const [y, m] = base.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  const newY = d.getFullYear();
  const newM = String(d.getMonth() + 1).padStart(2, "0");
  return `${newY}-${newM}`;
}

function formatMonthShort(monthKey: MonthKey): string {
  const [y, m] = monthKey.split("-");
  const yy = (y ?? "").slice(-2);
  return `${yy}/${m}`;
}

function formatMonthDay(dateStr: string): string {
  const m = (dateStr ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "--/--";
  return `${m[2]}/${m[3]}`;
}

function formatJapaneseMonthDay(dateStr: string): string {
  const m = (dateStr ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "--月--日";
  return `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
}

function shiftDateByDays(dateStr: string, offsetDays: number): string {
  const m = (dateStr ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return todayStr;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function formatCurrency(amount: number) {
  return amount.toLocaleString("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  });
}

/** 数値をカウントアップするアニメーションコンポーネント */
function AnimatedCounter({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 60, damping: 15 });
  const display = useTransform(spring, (latest) =>
    Math.floor(latest).toLocaleString("ja-JP", {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0,
    })
  );

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span className="tabular-nums">{display}</motion.span>;
}

/** 金額入力欄の表示用（カンマ区切り、0は空） */
function formatAmountForInput(amount: number): string {
  if (amount === 0) return "";
  return amount.toLocaleString("ja-JP");
}

/** 金額入力欄の文字列を数値に変換 */
function parseAmountInput(value: string): number {
  const n = parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* ---------- UI コンポーネント ---------- */

type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

type SummaryCardProps = {
  icon: LucideIcon;
  title: string;
  value: number;
  accentClass: string;
  displayOverride?: string;
  onClick?: () => void;
};

function SummaryCard({
  icon: Icon,
  title,
  value,
  accentClass,
  displayOverride,
  onClick,
}: SummaryCardProps) {
  const clickable = typeof onClick === "function";
  return (
    <Card
      className={`group border-l-4 p-3 sm:p-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${accentClass} ${
        clickable ? "cursor-pointer active:scale-[0.99]" : ""
      }`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }
          : undefined
      }
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:text-[11px]">
            {title}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="sm:hidden inline-flex rounded-xl bg-white/80 p-1.5 shadow-sm ring-1 ring-black/5">
              <Icon className="h-4 w-4 text-slate-600" />
            </span>
            <div className="text-xl font-bold tracking-tight sm:text-2xl md:text-3xl tabular-nums h-[1.2em] flex items-center">
              {displayOverride ? (
                <span>{displayOverride}</span>
              ) : (
                <AnimatedCounter value={value} />
              )}
            </div>
          </div>
        </div>
        <div className="hidden sm:flex rounded-2xl bg-white/80 p-2 sm:p-3 shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-110">
          <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-slate-600" />
        </div>
        </CardHeader>
    </Card>
  );
}

type MonthlyGraphItem = {
  monthKey: MonthKey;
  label: string;
  income: number;
  expenses: number;
  balance: number;
};

function MonthlyGraph({ items }: { items: MonthlyGraphItem[] }) {
  type GraphMode = "together" | "split";
  const [mode, setMode] = useState<GraphMode>("together");

  const maxTogether = Math.max(1, ...items.flatMap((i) => [i.income, i.expenses]));
  const maxIncome = Math.max(1, ...items.map((i) => i.income));
  const maxExpenses = Math.max(1, ...items.map((i) => i.expenses));

  const BarGrid = ({
    kind,
    maxValue,
  }: {
    kind: "income" | "expenses" | "both";
    maxValue: number;
  }) => {
    return (
      <div className="grid grid-cols-6 gap-2 sm:gap-3">
        {items.map((item) => {
          const balanceClass = item.balance >= 0 ? "text-emerald-700" : "text-rose-700";
          const incomePct = Math.max(0, Math.min(100, (item.income / maxValue) * 100));
          const expensesPct = Math.max(0, Math.min(100, (item.expenses / maxValue) * 100));

          const amountLine =
            kind === "income"
              ? { text: formatCurrency(item.income), className: "text-emerald-700" }
              : kind === "expenses"
              ? { text: formatCurrency(item.expenses), className: "text-rose-700" }
              : null;

          return (
            <div key={item.monthKey} className="flex flex-col items-center gap-2">
              <div className="h-44 w-full">
                {kind === "both" ? (
                  <div className="mx-auto flex h-full w-full items-end justify-center gap-1.5">
                    <div
                      className="w-3 rounded-lg bg-emerald-500 sm:w-3.5"
                      style={{ height: `${incomePct}%` }}
                      title={`収入 ${formatCurrency(item.income)}`}
                    />
                    <div
                      className="w-3 rounded-lg bg-rose-500 sm:w-3.5"
                      style={{ height: `${expensesPct}%` }}
                      title={`支出 ${formatCurrency(item.expenses)}`}
                    />
                  </div>
                ) : (
                  <div className="mx-auto flex h-full w-full items-end justify-center">
                    <div
                      className={`w-7 rounded-xl sm:w-8 ${kind === "income" ? "bg-emerald-500" : "bg-rose-500"}`}
                      style={{ height: `${kind === "income" ? incomePct : expensesPct}%` }}
                      title={`${kind === "income" ? "収入" : "支出"} ${
                        kind === "income" ? formatCurrency(item.income) : formatCurrency(item.expenses)
                      }`}
                    />
                  </div>
                )}
              </div>

              <div className="text-[11px] font-bold text-slate-600 tabular-nums">{item.label}</div>
              {kind === "both" ? (
                <div className={`text-[11px] font-bold tabular-nums ${balanceClass}`}>
                  {formatCurrency(item.balance)}
                </div>
              ) : (
                <div className={`text-[11px] font-bold tabular-nums ${amountLine?.className ?? "text-slate-600"}`}>
                  {amountLine?.text ?? "--"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-500">
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              収入
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              支出
            </div>
          </div>

          <div className="ml-auto flex items-center rounded-xl bg-slate-100 p-1 text-xs font-bold text-slate-600">
            <button
              type="button"
              onClick={() => setMode("together")}
              className={`rounded-lg px-3 py-1.5 transition ${
                mode === "together" ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-800"
              }`}
            >
              まとめて
            </button>
            <button
              type="button"
              onClick={() => setMode("split")}
              className={`rounded-lg px-3 py-1.5 transition ${
                mode === "split" ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-800"
              }`}
            >
              別々
            </button>
          </div>
        </div>

        {mode === "together" ? (
          <BarGrid kind="both" maxValue={maxTogether} />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <div className="space-y-3">
              <div className="text-xs font-bold text-slate-500">収入</div>
              <BarGrid kind="income" maxValue={maxIncome} />
            </div>
            <div className="space-y-3">
              <div className="text-xs font-bold text-slate-500">支出</div>
              <BarGrid kind="expenses" maxValue={maxExpenses} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type DailyExpensePanelProps = {
  date: string;
  entries: Entry[];
  onChangeEntries: (entries: Entry[]) => void;
  onOpenDetail: (entryId: string | number) => void;
  userId?: string;
  members?: { id: string; full_name?: string | null; avatar_url?: string | null }[];
  dataScope: DataScope;
};

function autoNameForNewEntry(base: string, existing: Entry[]): string {
  const b = (base ?? "").trim() || "支出";
  const hits = existing.filter((e) => (e.name ?? "").trim().startsWith(b)).length;
  return hits === 0 ? b : `${b} ${hits + 1}`;
}

function DailyExpenseRow({
  entry,
  onChange,
  onDelete,
  onOpenDetail,
  focusField,
  onFocused,
  userId,
  members,
}: {
  entry: Entry;
  onChange: (patch: Partial<Entry>) => void;
  onDelete: () => void;
  onOpenDetail: () => void;
  focusField: "name" | "amount" | null;
  onFocused: () => void;
  userId?: string;
  members?: { id: string; full_name?: string | null; avatar_url?: string | null }[];
}) {
  const controls = useDragControls();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const isLocked = entry.locked === true || typeof entry.lockedKey === "string";
  
  // 他のユーザーの項目かどうか（編集不可の判定）
  const isOtherUserEntry = useMemo(() => {
    if (!userId || !entry.created_by) return false;
    // 作成者が自分なら編集可能
    if (entry.created_by === userId) return false;
    // グループ作成の項目（origin_scope !== "personal"）なら誰でも編集可能
    if (entry.origin_scope !== "personal") return false;
    // 個人作成（origin_scope === "personal"）かつ自分以外の作成なら編集不可
    return true;
  }, [userId, entry.created_by, entry.origin_scope]);

  const shouldShowUserIcon = useMemo(() => {
    return entry.origin_scope === "personal" && entry.created_by;
  }, [entry.origin_scope, entry.created_by]);

  const creator = members?.find((m) => m.id === entry.created_by);

  useEffect(() => {
    if (isOtherUserEntry) return;
    if (focusField === "name") {
      nameRef.current?.focus();
      nameRef.current?.select();
      onFocused();
      return;
    }
    if (focusField === "amount") {
      amountRef.current?.focus();
      amountRef.current?.select();
      onFocused();
    }
  }, [focusField, onFocused, isOtherUserEntry]);

  return (
    <Reorder.Item
      value={entry}
      dragListener={false}
      dragControls={controls}
      onClick={onOpenDetail}
      className={`flex items-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm cursor-pointer hover:bg-slate-50 active:scale-[0.99] transition ${
        isOtherUserEntry ? "opacity-90" : ""
      }`}
    >
      <button
        type="button"
        onPointerDown={(e) => !isLocked && !isOtherUserEntry && controls.start(e)}
        onClick={(e) => e.stopPropagation()}
        className={`rounded-xl p-2 text-slate-300 transition hover:bg-slate-50 hover:text-slate-500 ${
          isLocked || isOtherUserEntry ? "cursor-default opacity-0" : "cursor-grab active:cursor-grabbing"
        }`}
        aria-label="並び替え"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div onClick={(e) => e.stopPropagation()} className={isLocked || isOtherUserEntry ? "opacity-50 pointer-events-none" : ""}>
        <Checkbox checked={entry.done} onChange={(v) => onChange({ done: v })} />
      </div>
      <div className="flex flex-1 items-center min-w-0 h-full gap-2">
        <input
          ref={nameRef}
          value={entry.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className={`bg-transparent text-[13px] font-bold outline-none transition-all ${
            entry.done ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700"
          } disabled:cursor-pointer`}
          style={{ width: entry.name.length > 0 ? `${Math.max(4, entry.name.length * 1.5 + 1)}ch` : "4ch" }}
          placeholder="未設定"
          disabled={isLocked || isOtherUserEntry}
        />
        {shouldShowUserIcon && (
          <div className="flex shrink-0 items-center" title={creator?.full_name || "ユーザー"}>
            {creator?.avatar_url ? (
              <img src={creator.avatar_url} className="h-4 w-4 rounded-full object-cover ring-1 ring-slate-200" alt="" />
            ) : (
              <User className="h-3.5 w-3.5 text-slate-300" />
            )}
          </div>
        )}
      </div>
      <div className="flex items-center h-full">
        <input
          ref={amountRef}
          inputMode="numeric"
          value={formatAmountForInput(entry.amount)}
          onChange={(e) => onChange({ amount: parseAmountInput(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-[13px] font-bold text-slate-900 tabular-nums shadow-sm focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 disabled:cursor-pointer disabled:bg-slate-50/50"
          placeholder="0"
          disabled={isLocked || isOtherUserEntry}
        />
      </div>
      {!isLocked && !isOtherUserEntry && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-xl p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
          aria-label="削除"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </Reorder.Item>
  );
}

function DailyExpensePanel({
  date,
  entries,
  onChangeEntries,
  onOpenDetail,
  userId,
  members,
  dataScope,
}: DailyExpensePanelProps) {
  const [focusTarget, setFocusTarget] = useState<{ entryId: string | number; field: "name" | "amount" } | null>(null);

  const applyFocusDone = useCallback(() => setFocusTarget(null), []);

  const addQuick = (name: string) => {
    const newId = generateUUID();
    const newEntry: Entry = {
      id: newId,
      name: autoNameForNewEntry(name, entries),
      amount: 0,
      note: "",
      date,
      done: true,
      created_by: userId,
      origin_scope: dataScope,
    };
    onChangeEntries([...entries, newEntry]);
    setFocusTarget({ entryId: newId, field: "amount" });
  };

  const updateEntry = (id: string | number, patch: Partial<Entry>) => {
    onChangeEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeEntry = (id: string | number) => {
    onChangeEntries(entries.filter((e) => e.id !== id));
  };

  const addBlank = () => {
    const newId = generateUUID();
    const newEntry: Entry = {
      id: newId,
      name: "",
      amount: 0,
      note: "",
      date,
      done: true,
      created_by: userId,
      origin_scope: dataScope,
    };
    onChangeEntries([...entries, newEntry]);
    setFocusTarget({ entryId: newId, field: "name" });
  };

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => addQuick("食費")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ 食費
          </button>
          <button
            type="button"
            onClick={() => addQuick("日用品")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ 日用品
          </button>
          <button
            type="button"
            onClick={() => addQuick("交通")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ 交通
          </button>
          <button
            type="button"
            onClick={() => addQuick("その他")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ その他
          </button>
        </div>

        <div className="space-y-2">
          <Reorder.Group axis="y" values={entries} onReorder={onChangeEntries} className="space-y-2">
            {entries.map((entry) => (
              <DailyExpenseRow
                key={entry.id}
                entry={entry}
                onChange={(patch) => updateEntry(entry.id, patch)}
                onDelete={() => removeEntry(entry.id)}
                onOpenDetail={() => onOpenDetail(entry.id)}
                focusField={focusTarget?.entryId === entry.id ? focusTarget.field : null}
                onFocused={applyFocusDone}
                userId={userId}
                members={members}
              />
            ))}
          </Reorder.Group>
          {entries.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">
              まだ入力がありません
            </div>
          )}

          <button
            type="button"
            onClick={addBlank}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white py-3 text-[13px] font-bold text-slate-400 transition-all hover:border-sky-300 hover:text-sky-600 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            追加
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

type MonthlyVariableExpensePanelProps = {
  monthKey: MonthKey;
  entries: Entry[];
  defaultDate: string;
  onChangeEntries: (entries: Entry[]) => void;
  onOpenDetail: (entryId: string | number) => void;
  userId?: string;
  members?: { id: string; full_name?: string | null; avatar_url?: string | null }[];
  dataScope: DataScope;
};

function MonthlyVariableExpensePanel({
  monthKey,
  entries,
  defaultDate,
  onChangeEntries,
  onOpenDetail,
  userId,
  members,
  dataScope,
}: MonthlyVariableExpensePanelProps) {
  const totalDone = useMemo(() => sumAmountDone(entries), [entries]);
  const isLocked = (e: Entry) => e.locked === true || typeof e.lockedKey === "string";

  // 他のユーザーの項目かどうか（編集不可の判定）
  const isOtherUserEntry = (e: Entry) => {
    if (!userId || !e.created_by) return false;
    // 作成者が自分なら編集可能
    if (e.created_by === userId) return false;
    // グループ作成の項目（origin_scope !== "personal"）なら誰でも編集可能
    if (e.origin_scope !== "personal") return false;
    // 個人作成（origin_scope === "personal"）かつ自分以外の作成なら編集不可
    return true;
  };

  const getCreatorInfo = (e: Entry) => {
    if (!members || !e.created_by) return null;
    return members.find((m) => m.id === e.created_by);
  };

  const addQuick = (name: string) => {
    const newId = generateUUID();
    const newEntry: Entry = {
      id: newId,
      name,
      amount: 0,
      note: "",
      date: defaultDate,
      done: true,
      created_by: userId,
      origin_scope: dataScope,
    };
    onChangeEntries([...entries, newEntry]);
  };

  const addBlank = () => addQuick("");

  const updateEntry = (id: string | number, patch: Partial<Entry>) => {
    onChangeEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeEntry = (id: string | number) => {
    const target = entries.find((e) => e.id === id);
    if (target && (isLocked(target) || isOtherUserEntry(target))) return;
    onChangeEntries(entries.filter((e) => e.id !== id));
  };

  const changeDone = (id: string | number, value: boolean) => {
    const target = entries.find((e) => e.id === id);
    if (target && (isLocked(target) || isOtherUserEntry(target))) return;
    updateEntry(id, { done: value });
  };

  return (
    <Card className="self-start">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-700">
            <Wallet className="h-3.5 w-3.5" />
            <span className="font-medium">変動支出（食費・日用品など）</span>
          </div>
          <div className="text-[11px] font-bold text-slate-400">{monthKey}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total</div>
          <div className="text-lg font-bold text-slate-700 tabular-nums">{formatCurrency(totalDone)}</div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => addQuick("食費")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ 食費
          </button>
          <button
            type="button"
            onClick={() => addQuick("日用品")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ 日用品
          </button>
          <button
            type="button"
            onClick={() => addQuick("交通")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
          >
            ＋ 交通
          </button>
          <button
            type="button"
            onClick={addBlank}
            className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-400 shadow-sm transition hover:border-sky-200 hover:text-sky-600 active:scale-[0.99]"
          >
            ＋ 追加
          </button>
        </div>

        <div className="space-y-2">
          {entries.map((entry) => {
            const locked = isLocked(entry);
            const otherUser = isOtherUserEntry(entry);
            const creator = getCreatorInfo(entry);
            return (
              <div key={entry.id} className={`flex items-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm ${otherUser ? 'opacity-90' : ''}`}>
                <div className={locked || otherUser ? "opacity-50 pointer-events-none" : ""}>
                  <Checkbox checked={entry.done} onChange={(v) => changeDone(entry.id, v)} />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    value={entry.name}
                    onChange={(e) => updateEntry(entry.id, { name: e.target.value })}
                    className={`min-w-0 flex-1 bg-transparent text-[13px] font-bold outline-none transition-all ${
                      entry.done ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700"
                    } disabled:cursor-pointer`}
                    placeholder="未設定"
                    disabled={locked || otherUser}
                  />
                  {entry.created_by && (
                    <div className="flex shrink-0 items-center" title={creator?.full_name || "ユーザー"}>
                      {creator?.avatar_url ? (
                        <img src={creator.avatar_url} className="h-4 w-4 rounded-full object-cover ring-1 ring-slate-200" alt="" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-slate-300" />
                      )}
                    </div>
                  )}
                </div>
                <input
                  type="date"
                  value={entry.date}
                  onChange={(e) => updateEntry(entry.id, { date: e.target.value })}
                  className="w-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-600 tabular-nums shadow-sm disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-pointer"
                  disabled={locked || otherUser}
                />
                <input
                  inputMode="numeric"
                  value={formatAmountForInput(entry.amount)}
                  onChange={(e) => updateEntry(entry.id, { amount: parseAmountInput(e.target.value) })}
                  className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-[13px] font-bold text-slate-900 tabular-nums shadow-sm disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-pointer"
                  placeholder="0"
                  disabled={locked || otherUser}
                />
                {locked || otherUser ? (
                  <button
                    type="button"
                    onClick={() => onOpenDetail(entry.id)}
                    className="rounded-xl p-2 text-slate-300 transition hover:bg-slate-50 hover:text-slate-500"
                    aria-label="詳細"
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="rounded-xl p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                    aria-label="削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}

          {entries.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">
              まだ入力がありません
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type EntryCardProps = {
  title: string;
  icon: any;
  color: "income" | "expense" | "detail";
  monthKey: MonthKey;
  entries: Entry[];
  onOpenCard: () => void;
  onChangeEntries: (entries: Entry[]) => void;
  onOpenDetail: (entryId: string | number) => void;
  hideCardTotal?: boolean;
  userId?: string;
  members?: { id: string; full_name?: string | null; avatar_url?: string | null }[];
  dataScope: DataScope;
};

function EntryCard({ title, icon: Icon, color, monthKey, entries, onOpenCard, onChangeEntries, onOpenDetail, hideCardTotal, userId, members, dataScope }: EntryCardProps) {
  const accent =
    color === "income"
      ? "text-emerald-700 bg-emerald-50"
      : color === "expense"
      ? "text-rose-700 bg-rose-50"
      : "text-sky-700 bg-sky-50";

  const isLocked = (e: Entry) => e.locked === true || typeof e.lockedKey === "string";

  // 他のユーザーの項目かどうか（編集不可の判定）
  const isOtherUserEntry = (e: Entry) => {
    if (!userId || !e.created_by) return false;
    // 作成者が自分なら編集可能
    if (e.created_by === userId) return false;
    // グループ作成の項目（origin_scope !== "personal"）なら誰でも編集可能
    if (e.origin_scope !== "personal") return false;
    // 個人作成（origin_scope === "personal"）かつ自分以外の作成なら編集不可
    return true;
  };

  const shouldShowUserIcon = (e: Entry) => {
    return e.origin_scope === "personal" && e.created_by;
  };

  const getCreatorInfo = (e: Entry) => {
    if (!members || !e.created_by) return null;
    return members.find((m) => m.id === e.created_by);
  };

  const handleChange = (id: string | number, field: keyof Entry, value: string | number | boolean) => {
    const target = entries.find((e) => e.id === id);
    if (target && (isLocked(target) || isOtherUserEntry(target))) return;
    
    onChangeEntries(
      entries.map((e) =>
        e.id === id
          ? {
                ...e,
                [field]:
                  field === "amount"
                    ? (typeof value === "number" ? value : Number(value) || 0)
                    : field === "done"
                    ? Boolean(value)
                    : value,
              }
          : e,
      ),
    );
  };

  const handleAddRow = () => {
    const newId = generateUUID();
    const next: Entry[] = [
      ...entries,
      {
        id: newId,
        name: "",
        amount: 0,
        note: "",
        date: `${monthKey}-01`,
        done: true,
        created_by: userId,
        origin_scope: dataScope,
      },
    ];
    onChangeEntries(next);
    onOpenDetail(newId);
  };

  const handleDeleteRow = (id: string | number) => {
    const target = entries.find((e) => e.id === id);
    if (target && isLocked(target)) return;
    onChangeEntries(entries.filter((e) => e.id !== id));
  };

  const handleClearAll = () => {
    if (entries.length === 0) return;
    if (!window.confirm("このカード内の項目をすべて削除しますか？")) return;
    onChangeEntries(entries.filter((e) => isLocked(e)));
  };

  const handleReorder = (newEntries: Entry[]) => {
    const locked = entries.filter((e) => isLocked(e));
    if (locked.length === 0) {
      onChangeEntries(newEntries);
      return;
    }
    const unlockedNew = newEntries.filter((e) => !isLocked(e));
    onChangeEntries([...locked, ...unlockedNew]);
  };

  const cardTotal = sumAmount(entries);

  return (
    <Card
      className="flex flex-col relative overflow-hidden self-start cursor-pointer active:scale-[0.997] transition-transform"
      onClick={onOpenCard}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenCard();
      }}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCard();
            }}
            className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ${accent}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="font-medium">{title}</span>
          </button>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClearAll();
            }}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 underline-offset-2 hover:text-rose-600 hover:underline md:text-xs"
          >
            <Trash2 className="h-3 w-3" />
            全て削除
          </button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {/* モバイル表示: カード形式 / デスクトップ表示: テーブル形式 */}
        <div className="block sm:hidden">
          <Reorder.Group 
            axis="y" 
            values={entries} 
            onReorder={handleReorder}
            className="space-y-2"
          >
            {entries.map((entry) => (
              <Reorder.Item
                key={entry.id}
                value={entry}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(entry.id);
                }}
                drag={isLocked(entry) || isOtherUserEntry(entry) ? false : "y"}
                className={`relative flex items-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm active:scale-[0.98] transition-all cursor-pointer ${
                  isOtherUserEntry(entry) ? "opacity-90" : ""
                }`}
              >
                <div 
                  className="flex shrink-0 items-center cursor-grab active:cursor-grabbing" 
                  onClick={(e) => e.stopPropagation()}
                >
                  {isLocked(entry) || isOtherUserEntry(entry) ? <span className="h-3.5 w-3.5" /> : <GripVertical className="h-3.5 w-3.5 text-slate-300" />}
                </div>
                <div 
                  className="flex shrink-0 items-center" 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={isLocked(entry) || isOtherUserEntry(entry) ? "opacity-50 pointer-events-none" : ""}>
                    <Checkbox
                      checked={entry.done}
                      onChange={(v) => handleChange(entry.id, "done", v)}
                    />
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <p className={`truncate text-[13px] font-bold leading-tight ${entry.done ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700'}`}>
                    {entry.name || "未設定"}
                  </p>
                  {shouldShowUserIcon(entry) && (
                    <div className="flex shrink-0 items-center" title={getCreatorInfo(entry)?.full_name || "ユーザー"}>
                      {getCreatorInfo(entry)?.avatar_url ? (
                        <img src={getCreatorInfo(entry)!.avatar_url!} className="h-4 w-4 rounded-full object-cover ring-1 ring-slate-200" alt="" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-slate-300" />
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[13px] font-bold leading-tight tabular-nums ${entry.done ? 'text-slate-400' : 'text-slate-900'}`}>
                    ¥{formatAmountForInput(entry.amount)}
                  </p>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
          
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddRow();
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white py-3 text-[13px] font-bold text-slate-400 transition-all hover:border-sky-300 hover:text-sky-600 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            新しい項目を追加
          </button>
        </div>

        <div className="hidden sm:block">
          <div className="grid grid-cols-[32px_48px_1fr_160px_48px] items-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <div title="ドラッグで並び替え"></div>
            <div className="text-center">完了</div>
            <div>項目名</div>
            <div className="text-right">金額</div>
            <div className="text-center">削除</div>
          </div>

          <Reorder.Group
            axis="y"
            values={entries}
            onReorder={handleReorder}
            className="mt-1"
          >
            {entries.map((entry) => (
              <Reorder.Item
                key={entry.id}
                value={entry}
                layout
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(entry.id);
                }}
                drag={isLocked(entry) || isOtherUserEntry(entry) ? false : "y"}
                className={`group cursor-pointer rounded-lg hover:bg-slate-50/80 transition-colors ${
                  isOtherUserEntry(entry) ? "opacity-80" : ""
                }`}
              >
                <div className="grid grid-cols-[32px_48px_1fr_160px_48px] items-center border-b border-slate-100 py-2">
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <span
                      className={`inline-flex cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover:opacity-100 transition-opacity ${
                        isLocked(entry) || isOtherUserEntry(entry) ? "pointer-events-none opacity-0" : ""
                      }`}
                      title="ドラッグで並び替え"
                    >
                      <GripVertical className="h-4 w-4 text-slate-300" />
                    </span>
                  </div>
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <div className={isLocked(entry) || isOtherUserEntry(entry) ? "opacity-50 pointer-events-none" : ""}>
                      <Checkbox checked={entry.done} onChange={(v) => handleChange(entry.id, "done", v)} />
                    </div>
                  </div>
                  <div className="pr-2 flex items-center gap-2">
                    <p
                      className={`truncate font-bold ${
                        entry.done ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700"
                      }`}
                    >
                      {entry.name || <span className="text-slate-300 font-normal">未設定</span>}
                    </p>
                    {shouldShowUserIcon(entry) && (
                      <div className="flex shrink-0 items-center" title={getCreatorInfo(entry)?.full_name || "ユーザー"}>
                        {getCreatorInfo(entry)?.avatar_url ? (
                          <img src={getCreatorInfo(entry)!.avatar_url!} className="h-4 w-4 rounded-full object-cover ring-1 ring-slate-100" alt="" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-slate-300" />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="pr-2">
                    <p className={`text-right font-bold tabular-nums ${entry.done ? "text-slate-400" : "text-slate-900"}`}>
                      ¥{formatAmountForInput(entry.amount)}
                    </p>
                  </div>
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    {isLocked(entry) || isOtherUserEntry(entry) ? (
                      <span className="h-7 w-7" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(entry.id)}
                        className="inline-flex items-center justify-center rounded-full p-1.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-50 hover:text-rose-600"
                        aria-label="この行を削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddRow();
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-100 bg-white py-3 text-xs font-bold text-slate-400 transition-all hover:border-sky-200 hover:bg-sky-50/30 hover:text-sky-600 md:text-sm"
          >
            <Plus className="h-4 w-4" />
            新しい項目を追加
          </button>
        </div>
        {!hideCardTotal && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Card Total
            </span>
            <span className="text-lg font-bold text-slate-700 tabular-nums">
              {formatCurrency(cardTotal)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type SectionHeaderProps = {
  title: string;
  description: string;
};

function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-1.5 border-l-4 border-slate-200 pl-4 py-1">
      <h2 className="text-base font-bold tracking-tight text-slate-800 md:text-lg">
        {title}
      </h2>
      <p className="text-xs font-medium text-slate-400 md:text-sm">{description}</p>
    </div>
  );
}

/* ---------- シンプルな Design System 風コンポーネント ---------- */

type CardProps = React.HTMLAttributes<HTMLDivElement>;

function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100 ${className}`}
      {...props}
    />
  );
}

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;

function CardHeader({ className = "", ...props }: CardHeaderProps) {
  return (
    <div className={`mb-3 flex flex-col ${className}`} {...props} />
  );
}

type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

function CardContent({ className = "", ...props }: CardContentProps) {
  return <div className={className} {...props} />;
}

type BadgeProps = {
  children: React.ReactNode;
  className?: string;
  variant?: "solid" | "outline" | "soft";
};

function Badge({ children, className = "", variant = "solid" }: BadgeProps) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const styles =
    variant === "outline"
      ? "border border-slate-300 bg-white text-slate-600"
      : variant === "soft"
      ? "bg-slate-100 text-slate-700"
      : "bg-slate-900 text-slate-50";
  return <span className={`${base} ${styles} ${className}`}>{children}</span>;
}

type CheckboxProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
};

function Checkbox({ checked, onChange }: CheckboxProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex h-5 w-5 items-center justify-center rounded border text-emerald-600 transition ${
        checked
          ? "border-emerald-500 bg-emerald-50"
          : "border-slate-300 bg-white hover:bg-slate-50"
      }`}
      aria-pressed={checked}
    >
      {checked && <CheckCircle2 className="h-4 w-4" />}
    </button>
  );
}

type BottomNavProps = {
  activeView: "main" | "monthly" | "daily" | "settings";
  dataScope: DataScope;
  onChangeView: (view: "main" | "monthly" | "daily" | "settings") => void;
  onPressShare: () => void;
};

function BottomNav({ activeView, dataScope, onChangeView, onPressShare }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-4 py-3 lg:px-8">
        <button
          type="button"
          onClick={() => onChangeView("main")}
          className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs font-bold transition ${
            activeView === "main" ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <LayoutDashboard className="h-5 w-5" />
          メイン
        </button>

        <button
          type="button"
          onClick={() => onChangeView("monthly")}
          className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs font-bold transition ${
            activeView === "monthly" ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <ListChecks className="h-5 w-5" />
          月別
        </button>

        <button
          type="button"
          onClick={onPressShare}
          className="flex flex-col items-center gap-1"
          aria-label={dataScope === "group" ? "個人モードへ" : "共有モードへ"}
        >
          <div className={`rounded-2xl p-3 text-white shadow-lg transition active:scale-95 ${
            dataScope === "group" ? "bg-slate-700 shadow-slate-700/20" : "bg-slate-900 shadow-slate-900/20"
          }`}>
            {dataScope === "group" ? <User className="h-6 w-6" /> : <Users className="h-6 w-6" />}
          </div>
          <span className="text-[10px] font-bold text-slate-400">
            {dataScope === "group" ? "個人" : "共有"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onChangeView("daily")}
          className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs font-bold transition ${
            activeView === "daily" ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <Calendar className="h-5 w-5" />
          日別
        </button>

        <button
          type="button"
          onClick={() => onChangeView("settings")}
          className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs font-bold transition ${
            activeView === "settings" ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <Settings className="h-5 w-5" />
          設定
        </button>
      </div>
    </nav>
  );
}

type GroupTopNavProps = {
  isOpen: boolean;
  householdName: string;
  members: { id: string; full_name?: string | null; avatar_url?: string | null }[];
  activeView: "main" | "monthly" | "daily" | "settings";
  onChangeView: (view: "main" | "monthly" | "daily" | "settings") => void;
  onClose: () => void;
  onSwitchPersonal: () => void;
};

function GroupTopNav({ isOpen, householdName, members, activeView, onChangeView, onClose, onSwitchPersonal }: GroupTopNavProps) {
  const visible = useMemo(() => members.slice(0, 4), [members]);
  const rest = Math.max(0, members.length - visible.length);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur border-t-[4px] border-t-slate-900"
        >
          <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
            <div className="min-w-0 flex items-center gap-2">
              <div className="flex flex-col">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">グループ</div>
                <div className="truncate text-sm font-bold text-slate-800">{householdName}</div>
              </div>
            </div>

            <div className="hidden items-center gap-1 rounded-2xl bg-slate-100 p-1 md:flex">
              <button
                type="button"
                onClick={() => onChangeView("main")}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeView === "main" ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                メイン
              </button>
              <button
                type="button"
                onClick={() => onChangeView("monthly")}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeView === "monthly" ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                月別
              </button>
              <button
                type="button"
                onClick={() => onChangeView("daily")}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeView === "daily" ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                日別
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center -space-x-2">
                {visible.map((m) => (
                  <div
                    key={m.id}
                    className="h-8 w-8 overflow-hidden rounded-full bg-slate-200 ring-2 ring-white shadow-sm flex items-center justify-center"
                    title={m.full_name ?? ""}
                  >
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt={m.full_name ?? "user"} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-slate-600">{(m.full_name ?? "U").slice(0, 1)}</span>
                    )}
                  </div>
                ))}
                {rest > 0 && (
                  <div className="h-8 w-8 rounded-full bg-slate-100 ring-2 ring-white shadow-sm flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-500">+{rest}</span>
                  </div>
                )}
              </div>

              <div className="hidden h-6 w-px bg-slate-200 md:block" />

              <button
                type="button"
                onClick={onSwitchPersonal}
                className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] md:flex"
              >
                <User className="h-3.5 w-3.5" />
                個人
              </button>
              
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type QuickAddModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (group: DetailGroup) => void;
};

function QuickAddModal({ isOpen, onClose, onSelect }: QuickAddModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
            initial={{ y: 24, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 24, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-bold text-slate-800">追加するカテゴリ</h3>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 p-6">
              <button
                type="button"
                onClick={() => onSelect("income")}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition hover:bg-slate-50"
              >
                <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
                  <ReceiptJapaneseYen className="h-5 w-5" />
                </div>
                <div className="text-sm font-bold text-slate-700">収入</div>
              </button>
              <button
                type="button"
                onClick={() => onSelect("otherIncome")}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition hover:bg-slate-50"
              >
                <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
                  <Landmark className="h-5 w-5" />
                </div>
                <div className="text-sm font-bold text-slate-700">その他収入</div>
              </button>
              <button
                type="button"
                onClick={() => onSelect("fixedExpenses")}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition hover:bg-slate-50"
              >
                <div className="rounded-xl bg-rose-50 p-2 text-rose-700">
                  <Home className="h-5 w-5" />
                </div>
                <div className="text-sm font-bold text-slate-700">固定支出</div>
              </button>
              <button
                type="button"
                onClick={() => onSelect("variableExpenses")}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition hover:bg-slate-50"
              >
                <div className="rounded-xl bg-rose-50 p-2 text-rose-700">
                  <Wallet className="h-5 w-5" />
                </div>
                <div className="text-sm font-bold text-slate-700">変動支出</div>
              </button>
              <button
                type="button"
                onClick={() => onSelect("communications")}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition hover:bg-slate-50"
              >
                <div className="rounded-xl bg-sky-50 p-2 text-sky-700">
                  <Phone className="h-5 w-5" />
                </div>
                <div className="text-sm font-bold text-slate-700">通信料金</div>
              </button>
              <button
                type="button"
                onClick={() => onSelect("loans")}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition hover:bg-slate-50"
              >
                <div className="rounded-xl bg-sky-50 p-2 text-sky-700">
                  <Landmark className="h-5 w-5" />
                </div>
                <div className="text-sm font-bold text-slate-700">借金・ローン</div>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DailySummaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  dateLabel: string;
  totalAmount: number;
  entries: Entry[];
  onOpenEntry: (entryId: string | number) => void;
};

function DailySummaryModal({ isOpen, onClose, dateLabel, totalAmount, entries, onOpenEntry }: DailySummaryModalProps) {
  type Mode = "summary" | "details";

  const [mode, setMode] = useState<Mode>("summary");

  useEffect(() => {
    if (isOpen) setMode("summary");
  }, [isOpen]);

  const doneEntries = useMemo(() => entries.filter((e) => e.done), [entries]);
  const sorted = useMemo(() => [...doneEntries].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)), [doneEntries]);
  const top = useMemo(() => sorted.slice(0, 5), [sorted]);

  const palette = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#2563eb", "#a855f7"];
  const total = useMemo(() => (Number.isFinite(totalAmount) ? totalAmount : 0), [totalAmount]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{dateLabel}</div>
                <h3 className="text-lg font-bold text-slate-800">今日の支出サマリー</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMode((m) => (m === "summary" ? "details" : "summary"))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  {mode === "summary" ? "内訳の詳細" : "サマリーに戻る"}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {mode === "summary" ? (
              <div className="grid grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">合計</div>
                    <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{formatCurrency(total)}</div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">内訳</div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 flex">
                      {sorted
                        .filter((e) => (e.amount ?? 0) > 0 && total > 0)
                        .map((e, idx) => (
                          <div
                            key={e.id}
                            style={{ width: `${((e.amount ?? 0) / total) * 100}%`, background: palette[idx % palette.length] }}
                          />
                        ))}
                    </div>
                    <div className="space-y-2">
                      {top.map((e, idx) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => onOpenEntry(e.id)}
                          className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-left transition hover:bg-slate-100 active:scale-[0.99]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: palette[idx % palette.length] }} />
                            <span className="text-sm font-bold text-slate-700">{e.name || "未設定"}</span>
                          </div>
                          <span className="text-sm font-bold text-rose-700 tabular-nums">{formatCurrency(e.amount ?? 0)}</span>
                        </button>
                      ))}
                      {top.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">
                          まだ入力がありません
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">全項目</div>
                  <div className="space-y-2">
                    {sorted.map((e, idx) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onOpenEntry(e.id)}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-white p-3 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: palette[idx % palette.length] }} />
                          <span className="min-w-0 truncate text-sm font-bold text-slate-700">{e.name || "未設定"}</span>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(e.amount ?? 0)}</span>
                      </button>
                    ))}
                    {sorted.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">
                        まだ入力がありません
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="space-y-3">
                  {sorted.map((e, idx) => {
                    const pct = total > 0 ? ((e.amount ?? 0) / total) * 100 : 0;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onOpenEntry(e.id)}
                        className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-800 truncate">{e.name || "未設定"}</div>
                            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full"
                                style={{
                                  width: `${pct}%`,
                                  background: palette[idx % palette.length],
                                }}
                              />
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(e.amount ?? 0)}</div>
                            <div className="text-[11px] font-bold text-slate-400 tabular-nums">{pct.toFixed(1)}%</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DailyTotalsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  monthLabel: string;
  monthKey: string;
  monthTotal: number;
  rows: { date: string; total: number; count: number }[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

type DailyCalendarModalProps = {
  isOpen: boolean;
  onClose: () => void;
  monthKey: string;
  rows: { date: string; total: number; count: number }[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

function DailyCalendarModal({ isOpen, onClose, monthKey, rows, selectedDate, onSelectDate }: DailyCalendarModalProps) {
  const map = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const r of rows) m.set(r.date, { total: r.total, count: r.count });
    return m;
  }, [rows]);

  const first = useMemo(() => new Date(`${monthKey}-01T00:00:00`), [monthKey]);
  const year = useMemo(() => first.getFullYear(), [first]);
  const monthIndex = useMemo(() => first.getMonth(), [first]);
  const startWeekday = useMemo(() => new Date(year, monthIndex, 1).getDay(), [year, monthIndex]);
  const daysInMonth = useMemo(() => new Date(year, monthIndex + 1, 0).getDate(), [year, monthIndex]);

  const cells = useMemo(() => {
    const out: Array<{ date: string | null; day: number | null }> = [];
    for (let i = 0; i < startWeekday; i++) out.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, "0");
      out.push({ date: `${monthKey}-${dayStr}`, day: d });
    }
    while (out.length < 42) out.push({ date: null, day: null });
    return out;
  }, [daysInMonth, monthKey, startWeekday]);

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 16 }}
            className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{monthKey}</div>
                <h3 className="text-lg font-bold text-slate-800">日別支出カレンダー</h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-6">
              <div className="grid grid-cols-7 gap-2">
                {weekdays.map((w) => (
                  <div key={w} className="text-center text-[10px] font-bold text-slate-400">
                    {w}
                  </div>
                ))}
                {cells.map((c, idx) => {
                  if (!c.date) {
                    return <div key={idx} className="h-16 rounded-2xl bg-transparent" />;
                  }
                  const date = c.date;
                  const info = map.get(date);
                  const total = info?.total ?? 0;
                  const count = info?.count ?? 0;
                  const selected = date === selectedDate;
                  const has = total > 0 || count > 0;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => {
                        onSelectDate(date);
                        onClose();
                      }}
                      className={`h-16 rounded-2xl border p-2 text-left transition active:scale-[0.99] ${
                        selected
                          ? "border-sky-200 bg-sky-50"
                          : has
                          ? "border-rose-100 bg-rose-50/30 hover:bg-rose-50"
                          : "border-slate-100 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="text-xs font-bold text-slate-700">{c.day}</div>
                        {count > 0 && <div className="text-[10px] font-bold text-slate-400">{count}件</div>}
                      </div>
                      <div className={`mt-1 text-[11px] font-bold tabular-nums ${has ? "text-rose-700" : "text-slate-300"}`}>
                        {has ? formatCurrency(total) : "--"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DailyTotalsModal({
  isOpen,
  onClose,
  monthLabel,
  monthKey,
  monthTotal,
  rows,
  selectedDate,
  onSelectDate,
}: DailyTotalsModalProps) {
  type Mode = "summary" | "list";
  type SortMode = "date_asc" | "date_desc" | "amount_desc";

  const [mode, setMode] = useState<Mode>("summary");
  const [sortMode, setSortMode] = useState<SortMode>("date_desc");
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode("summary");
      setCalendarOpen(false);
    }
  }, [isOpen]);

  const sorted = useMemo(() => {
    const base = [...rows];
    if (sortMode === "amount_desc") return base.sort((a, b) => b.total - a.total);
    if (sortMode === "date_asc") return base.sort((a, b) => a.date.localeCompare(b.date));
    return base.sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, sortMode]);

  const top = useMemo(() => [...rows].sort((a, b) => b.total - a.total).slice(0, 5), [rows]);
  const total = useMemo(() => (Number.isFinite(monthTotal) ? monthTotal : 0), [monthTotal]);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-slate-800">日別合計</h2>
                <p className="text-xs font-medium text-slate-400">{monthLabel}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCalendarOpen(true)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  カレンダー
                </button>
                <button
                  onClick={() => setMode((m) => (m === "summary" ? "list" : "summary"))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  {mode === "summary" ? "一覧" : "内訳"}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {mode === "summary" ? (
              <div className="grid grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">合計</div>
                    <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{formatCurrency(total)}</div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">支出が多い日</div>
                    <div className="space-y-2">
                      {top.map((r) => (
                        <button
                          key={r.date}
                          type="button"
                          onClick={() => onSelectDate(r.date)}
                          className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-left transition hover:bg-slate-100 active:scale-[0.99]"
                        >
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-slate-400">{formatJapaneseMonthDay(r.date)}</span>
                            <span className="text-sm font-bold text-slate-700">{r.count}件</span>
                          </div>
                          <span className="text-sm font-bold text-rose-700 tabular-nums">{formatCurrency(r.total)}</span>
                        </button>
                      ))}
                      {top.length === 0 && (
                        <div className="py-8 text-center text-sm font-medium text-slate-400">データがありません</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">一覧</div>
                  <div className="space-y-2 overflow-y-auto max-h-[50vh] pr-1">
                    {rows.map((r) => {
                      const pct = total > 0 ? (r.total / total) * 100 : 0;
                      const selected = r.date === selectedDate;
                      return (
                        <button
                          key={r.date}
                          type="button"
                          onClick={() => onSelectDate(r.date)}
                          className={`w-full rounded-2xl border p-3 text-left shadow-sm transition active:scale-[0.99] ${
                            selected ? "border-sky-200 bg-sky-50" : "border-slate-100 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-600">{formatJapaneseMonthDay(r.date)}</div>
                              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full bg-rose-400" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(r.total)}</div>
                              <div className="text-[11px] font-bold text-slate-400">{r.count}件</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {rows.length === 0 && (
                      <div className="py-8 text-center text-sm font-medium text-slate-400">データがありません</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">並び替え</div>
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm outline-none focus:border-sky-500"
                  >
                    <option value="date_desc">日付（新しい順）</option>
                    <option value="date_asc">日付（古い順）</option>
                    <option value="amount_desc">金額（高い順）</option>
                  </select>
                </div>
                <div className="space-y-3">
                  {sorted.map((r) => {
                    const pct = total > 0 ? (r.total / total) * 100 : 0;
                    const selected = r.date === selectedDate;
                    return (
                      <button
                        key={r.date}
                        type="button"
                        onClick={() => onSelectDate(r.date)}
                        className={`w-full rounded-2xl border p-4 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99] ${
                          selected ? "border-sky-200 bg-sky-50" : "border-slate-100 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-800">{formatJapaneseMonthDay(r.date)}</div>
                            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full bg-rose-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(r.total)}</div>
                            <div className="text-[11px] font-bold text-slate-400 tabular-nums">{pct.toFixed(1)}%</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {rows.length === 0 && (
                    <div className="py-8 text-center text-sm font-medium text-slate-400">データがありません</div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
      <DailyCalendarModal
        isOpen={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        monthKey={monthKey}
        rows={rows}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
      />
    </>
  );
}

type AdminDangerModalProps = {
  isOpen: boolean;
  busy: boolean;
  isDeletingMember: boolean;
  targetLabel: string;
  password: string;
  checked: boolean;
  onChangePassword: (value: string) => void;
  onChangeChecked: (value: boolean) => void;
  onClose: () => void;
  onRun: () => void;
};

function AdminDangerModal({
  isOpen,
  busy,
  isDeletingMember,
  targetLabel,
  password,
  checked,
  onChangePassword,
  onChangeChecked,
  onClose,
  onRun,
}: AdminDangerModalProps) {
  const title = isDeletingMember ? "ユーザーを削除" : "全てのデータを消去";
  const description = isDeletingMember
    ? `「${targetLabel}」を削除します。削除後はログインできなくなります。`
    : "この世帯の全入力データを削除します。元に戻せません。";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={busy ? undefined : onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 16 }}
            className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-rose-500">Danger</div>
                  <h3 className="mt-1 text-lg font-bold text-slate-800">{title}</h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-500">{description}</p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">管理者パスワード</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => onChangePassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-rose-500"
                  placeholder="パスワードを入力"
                  disabled={busy}
                />
              </div>

              <label className="flex items-center gap-2 text-sm font-bold text-slate-600 select-none">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChangeChecked(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                  disabled={busy}
                />
                この操作を理解しました
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={onRun}
                  disabled={busy || !password || !checked}
                  className="flex-1 rounded-xl bg-rose-600 py-2 text-xs font-bold text-white transition hover:bg-rose-700 active:scale-95 disabled:opacity-50"
                >
                  {busy ? "処理中..." : "実行"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type SummaryBreakdownItem = { label: string; value: number; colorClass: string };
type SummaryEntryRow = Entry & { groupLabel: string; groupKey: DetailGroup };

type SummaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenEntry: (group: DetailGroup, entryId: string | number) => void;
  title: string;
  monthLabel: string;
  totalAmount: number;
  breakdown: SummaryBreakdownItem[];
  entries: SummaryEntryRow[];
};

function SummaryModal({ isOpen, onClose, onOpenEntry, title, monthLabel, totalAmount, breakdown, entries }: SummaryModalProps) {
  type SortMode = "added" | "date_desc" | "date_asc" | "amount_asc" | "amount_desc";
  type Mode = "summary" | "details";

  const [mode, setMode] = useState<Mode>("summary");
  const [sortMode, setSortMode] = useState<SortMode>("date_desc");

  useEffect(() => {
    if (isOpen) setMode("summary");
  }, [isOpen]);

  const total = breakdown.reduce((s, b) => s + (Number.isFinite(b.value) ? b.value : 0), 0);

  const colorToPillClass = (colorClass: string) => {
    const m = colorClass.match(/bg-([a-z]+)-(\d{2,3})/);
    if (!m) return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    const c = m[1];
    return `bg-${c}-50 text-${c}-700 ring-1 ring-${c}-200`;
  };

  const groupToPillClass = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of breakdown) map.set(b.label, colorToPillClass(b.colorClass));
    return map;
  }, [breakdown]);

  const palette = [
    "#2563eb",
    "#22c55e",
    "#f97316",
    "#a855f7",
    "#ef4444",
    "#06b6d4",
    "#eab308",
    "#14b8a6",
  ];

  const paletteOffsetFromColorClass = (colorClass: string) => {
    const m = colorClass.match(/bg-([a-z]+)-(\d{2,3})/);
    const c = m?.[1];
    if (c === "emerald") return 1;
    if (c === "rose") return 4;
    if (c === "sky") return 5;
    if (c === "indigo") return 3;
    return 0;
  };

  const itemColor = (index: number, offset: number) => palette[(offset + index) % palette.length];

  const doneEntries = useMemo(() => entries.filter((e) => e.done), [entries]);

  const sortEntries = useCallback(
    (list: SummaryEntryRow[]) => {
      const base = list.map((e, idx) => ({ e, idx }));
      const byDateAsc = (a: typeof base[number], b: typeof base[number]) =>
        (a.e.date || "").localeCompare(b.e.date || "") || a.idx - b.idx;
      const byDateDesc = (a: typeof base[number], b: typeof base[number]) =>
        (b.e.date || "").localeCompare(a.e.date || "") || a.idx - b.idx;
      const byAmountAsc = (a: typeof base[number], b: typeof base[number]) =>
        (a.e.amount ?? 0) - (b.e.amount ?? 0) || a.idx - b.idx;
      const byAmountDesc = (a: typeof base[number], b: typeof base[number]) =>
        (b.e.amount ?? 0) - (a.e.amount ?? 0) || a.idx - b.idx;

      if (sortMode === "added") return base.sort((a, b) => a.idx - b.idx).map(({ e }) => e);
      if (sortMode === "date_asc") return base.sort(byDateAsc).map(({ e }) => e);
      if (sortMode === "date_desc") return base.sort(byDateDesc).map(({ e }) => e);
      if (sortMode === "amount_asc") return base.sort(byAmountAsc).map(({ e }) => e);
      return base.sort(byAmountDesc).map(({ e }) => e);
    },
    [sortMode],
  );

  const sorted = useMemo(() => sortEntries(doneEntries), [doneEntries, sortEntries]);

  const doneEntriesByLabel = useMemo(() => {
    const map = new Map<string, SummaryEntryRow[]>();
    for (const e of doneEntries) {
      const list = map.get(e.groupLabel);
      if (list) list.push(e);
      else map.set(e.groupLabel, [e]);
    }
    return map;
  }, [doneEntries]);

  const moneyColorClass = title === "収入" ? "text-emerald-700" : "text-rose-700";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{monthLabel}</div>
                <h3 className="text-lg font-bold text-slate-800">{title}サマリー</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMode((m) => (m === "summary" ? "details" : "summary"))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  {mode === "summary" ? "内訳の詳細" : "サマリーに戻る"}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {mode === "summary" ? (
              <div className="grid grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">合計</div>
                    <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{formatCurrency(totalAmount)}</div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">内訳</div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 flex">
                      {breakdown
                        .filter((b) => b.value > 0 && total > 0)
                        .map((b) => (
                          <div
                            key={b.label}
                            className={b.colorClass}
                            style={{ width: `${(b.value / total) * 100}%` }}
                          />
                        ))}
                    </div>
                    <div className="space-y-2">
                      {breakdown.map((b) => (
                        <div key={b.label} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`h-2.5 w-2.5 rounded-full ${b.colorClass}`} />
                            <span className="truncate text-sm font-bold text-slate-700">{b.label}</span>
                          </div>
                          <span className="text-sm font-bold text-slate-700 tabular-nums">{formatCurrency(b.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">一覧</div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-bold text-slate-400">{sorted.length}件</span>
                      <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 outline-none transition focus:ring-4 focus:ring-sky-500/10"
                      >
                        <option value="added">追加順</option>
                        <option value="date_desc">日付順（新しい）</option>
                        <option value="date_asc">日付順（古い）</option>
                        <option value="amount_asc">安い順</option>
                        <option value="amount_desc">高い順</option>
                      </select>
                    </div>
                  </div>
                  <div className="max-h-[50vh] overflow-auto rounded-2xl border border-slate-100">
                    <div className="divide-y divide-slate-100">
                      {sorted.map((e) => (
                        <div key={`${e.groupLabel}-${e.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${groupToPillClass.get(e.groupLabel) ?? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"}`}>
                                {e.groupLabel}
                              </span>
                              <span className="truncate text-sm font-bold text-slate-700">{e.name || "未設定"}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] font-medium text-slate-400">{e.date}</div>
                          </div>
                          <div className={`shrink-0 text-sm font-bold tabular-nums ${moneyColorClass}`}>{formatCurrency(e.amount)}</div>
                        </div>
                      ))}
                      {sorted.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm font-medium text-slate-400">データがありません</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-6 py-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">内訳の詳細</div>
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 outline-none transition focus:ring-4 focus:ring-sky-500/10"
                  >
                    <option value="added">追加順</option>
                    <option value="date_desc">日付順（新しい）</option>
                    <option value="date_asc">日付順（古い）</option>
                    <option value="amount_asc">安い順</option>
                    <option value="amount_desc">高い順</option>
                  </select>
                </div>

                <div className="max-h-[60vh] overflow-auto space-y-3">
                  {breakdown.map((b) => {
                    const list = sortEntries(doneEntriesByLabel.get(b.label) ?? []);
                    const paletteOffset = paletteOffsetFromColorClass(b.colorClass);
                    const listByAmount = [...(doneEntriesByLabel.get(b.label) ?? [])].sort(
                      (a, b2) => (b2.amount ?? 0) - (a.amount ?? 0),
                    );
                    const itemTotal = b.value;
                    const graphItemsRaw = listByAmount.filter((e) => (e.amount ?? 0) > 0);
                    const maxSegments = 8;
                    const graphMain = graphItemsRaw.slice(0, maxSegments);
                    const graphRest = graphItemsRaw.slice(maxSegments);
                    const restSum = graphRest.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0);
                    const otherColor = "#94a3b8";
                    const entryColorMap = new Map<string | number, string>();
                    const segments = [
                      ...graphMain.map((e, idx) => ({
                        key: `${e.groupLabel}-${e.id}`,
                        label: e.name || "未設定",
                        amount: e.amount,
                        color: itemColor(idx, paletteOffset),
                      })),
                      ...(restSum > 0
                        ? [
                            {
                              key: `${b.label}-rest`,
                              label: "その他",
                              amount: restSum,
                              color: otherColor,
                            },
                          ]
                        : []),
                    ];
                    for (const [idx, e] of graphMain.entries()) entryColorMap.set(e.id, itemColor(idx, paletteOffset));

                    return (
                      <div key={b.label} className="overflow-hidden rounded-2xl border border-slate-100">
                        <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${b.colorClass}`} />
                            <span className="truncate text-sm font-bold text-slate-700">{b.label}</span>
                            <span className="text-[11px] font-bold text-slate-400">{list.length}件</span>
                          </div>
                          <div className="shrink-0 text-sm font-bold text-slate-700 tabular-nums">{formatCurrency(b.value)}</div>
                        </div>
                        <div className="px-4 pb-3 space-y-2">
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 flex">
                            {segments
                              .filter((s) => itemTotal > 0 && s.amount > 0)
                              .map((s) => (
                                <div
                                  key={s.key}
                                  style={{ width: `${(s.amount / itemTotal) * 100}%`, backgroundColor: s.color }}
                                  title={`${s.label}: ${formatCurrency(s.amount)}`}
                                />
                              ))}
                          </div>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {list.map((e) => (
                            (() => {
                              const dotColor = entryColorMap.get(e.id) ?? otherColor;
                              const pct =
                                itemTotal > 0 && (e.amount ?? 0) > 0
                                  ? `${Math.round(((e.amount ?? 0) / itemTotal) * 100)}%`
                                  : "--";
                              return (
                            <button
                              key={`${e.groupLabel}-${e.id}`}
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenEntry(e.groupKey, e.id);
                              }}
                              className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                                  <div className="truncate text-sm font-bold text-slate-700">{e.name || "未設定"}</div>
                                </div>
                                <div className="mt-0.5 text-[11px] font-medium text-slate-400">{e.date}</div>
                              </div>
                              <div className="shrink-0 flex items-baseline gap-2">
                                <div className={`text-sm font-bold tabular-nums ${moneyColorClass}`}>{formatCurrency(e.amount)}</div>
                                <div className="text-[11px] font-bold text-slate-400 tabular-nums">{pct}</div>
                              </div>
                            </button>
                              );
                            })()
                          ))}
                          {list.length === 0 && (
                            <div className="px-4 py-6 text-center text-sm font-medium text-slate-400">データがありません</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- 詳細編集モーダル ---------- */

type DetailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  entry: Entry;
  onSave: (field: keyof Entry, value: string | number | boolean) => void;
  onDelete: () => void;
  disableDate?: boolean;
  userId?: string;
  members?: { id: string; full_name?: string | null; avatar_url?: string | null }[];
};

function DetailModal({ isOpen, onClose, entry, onSave, onDelete, disableDate, userId, members }: DetailModalProps) {
  // 他のユーザーの項目かどうか（編集不可の判定）
  const isOtherUserEntry = useMemo(() => {
    if (!userId || !entry.created_by) return false;
    // 作成者が自分なら編集可能
    if (entry.created_by === userId) return false;
    // グループ作成の項目（origin_scope !== "personal"）なら誰でも編集可能
    if (entry.origin_scope !== "personal") return false;
    // 個人作成（origin_scope === "personal"）かつ自分以外の作成なら編集不可
    return true;
  }, [userId, entry.created_by, entry.origin_scope]);

  if (!isOpen) return null;
  const locked = entry.locked === true;

  const dateDisabled = !!(locked || disableDate === true || isOtherUserEntry);
  const creator = members?.find((m) => m.id === entry.created_by);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-slate-800">項目の詳細編集</h3>
            {isOtherUserEntry && (
              <Badge variant="soft" className="bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                閲覧のみ
              </Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {/* 作成者情報 */}
          {entry.created_by && (
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3">
              <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden">
                {creator?.avatar_url ? (
                  <img src={creator.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-4 w-4 text-slate-400" />
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">作成者</p>
                <p className="text-xs font-bold text-slate-700">{creator?.full_name || "不明なユーザー"}</p>
              </div>
            </div>
          )}

          {/* 完了ステータス */}
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 ${entry.done ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">完了としてマーク</p>
                <p className="text-xs text-slate-500">収支合計に含める</p>
              </div>
            </div>
            <div className={locked || isOtherUserEntry ? "opacity-50 pointer-events-none" : ""}>
              <Checkbox checked={entry.done} onChange={(v) => onSave("done", v)} />
            </div>
          </div>

          {/* メイン入力 */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> 項目名
              </label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-medium outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 disabled:bg-slate-50 disabled:text-slate-400"
                value={entry.name}
                onChange={(e) => onSave("name", e.target.value)}
                placeholder="例: 家賃 / 給料 / 食費"
                autoFocus
                disabled={!!(locked || isOtherUserEntry)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="text-xs font-bold">¥</span> 金額
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-right text-base font-bold outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
                    value={formatAmountForInput(entry.amount)}
                    onChange={(e) => onSave("amount", parseAmountInput(e.target.value))}
                    placeholder="0"
                    disabled={!!(locked || isOtherUserEntry)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" /> 日付
                </label>
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 disabled:bg-slate-50 disabled:text-slate-400"
                  value={entry.date}
                  onChange={(e) => onSave("date", e.target.value)}
                  disabled={!!dateDisabled}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> 備考・メモ
              </label>
              <textarea
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 min-h-[100px] resize-none disabled:bg-slate-50 disabled:text-slate-400"
                value={entry.note}
                onChange={(e) => onSave("note", e.target.value)}
                placeholder="詳細なメモを入力..."
                disabled={!!(locked || isOtherUserEntry)}
              />
            </div>
          </div>
        </div>

        <div className="bg-slate-50 px-6 py-4 flex items-center justify-between gap-3">
          {locked || isOtherUserEntry ? <div /> : (
            <button
              onClick={() => {
                if (window.confirm("この項目を削除してもよろしいですか？")) {
                  onDelete();
                  onClose();
                }
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              削除
            </button>
          )}
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all active:scale-95"
          >
            {locked || isOtherUserEntry ? "閉じる" : "保存して閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}
