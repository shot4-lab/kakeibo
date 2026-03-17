'use server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function adminCreateUserAction(subId: string, subPassword: string, subDisplayName: string, householdId: string) {
  const supabase = getSupabaseAdmin()
  const email = `${subId}@kakeibo.local`
  
  try {
    // 1. 管理者権限でユーザーを作成 (メール確認なしで即時承認)
    const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: subPassword,
      email_confirm: true, // 自動でメール確認済みにする (重要!)
      user_metadata: { username: subDisplayName }
    })
    
    if (createError) {
      if (createError.message.includes('already exists')) {
        throw new Error('このログインIDは既に使用されています。別のIDを試してください。')
      }
      throw createError
    }
    if (!user) throw new Error('User creation failed')

    // 2. プロフィールを世帯に紐付ける (ここで直接書き込む)
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        household_id: householdId,
        full_name: subDisplayName,
        username: subId, // ログインIDをusernameとして保存
        role: 'member'
      })
    
    if (profileError) throw profileError

    return { success: true }
  } catch (err: any) {
    console.error('Admin user creation error:', err)
    return { success: false, error: err.message }
  }
}

export async function adminPurgeHouseholdDataAction(householdId: string) {
  const supabase = getSupabaseAdmin()

  try {
    const { error } = await supabase.from('entries').delete().eq('household_id', householdId)
    if (error) throw error
    return { success: true as const }
  } catch (err: any) {
    console.error('Admin purge household error:', err)
    return { success: false as const, error: err.message }
  }
}

export async function adminDeleteHouseholdMemberAction(targetUserId: string, householdId: string) {
  const supabase = getSupabaseAdmin()

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, household_id')
      .eq('id', targetUserId)
      .single()

    if (profileError) throw profileError
    if (!profile) throw new Error('ユーザーが見つかりません。')
    if (profile.household_id !== householdId) throw new Error('この世帯のユーザーではありません。')
    if (profile.role === 'admin') throw new Error('管理者ユーザーは削除できません。')

    const { data: adminProfile, error: adminError } = await supabase
      .from('profiles')
      .select('id')
      .eq('household_id', householdId)
      .eq('role', 'admin')
      .maybeSingle()

    if (adminError) throw adminError
    if (!adminProfile?.id) throw new Error('管理者が見つかりません。')

    const { error: reassignError } = await supabase
      .from('entries')
      .update({ created_by: adminProfile.id })
      .eq('household_id', householdId)
      .eq('created_by', targetUserId)
    if (reassignError) throw reassignError

    const { error: reassignHouseholdsError } = await supabase
      .from('households')
      .update({ created_by: adminProfile.id })
      .eq('created_by', targetUserId)
    if (reassignHouseholdsError) throw reassignHouseholdsError

    const { data: remainingHouseholds, error: remainingHouseholdsError } = await supabase
      .from('households')
      .select('id')
      .eq('created_by', targetUserId)
    if (remainingHouseholdsError) throw remainingHouseholdsError
    if ((remainingHouseholds ?? []).length > 0) {
      throw new Error('ユーザー削除の前提条件（households.created_by）の更新に失敗しました。')
    }

    const removeAvatarObjects = async () => {
      let offset = 0
      while (true) {
        const { data, error } = await supabase.storage
          .from('avatars')
          .list('avatars', { limit: 100, offset, search: `${targetUserId}-` })
        if (error) throw error
        const names = (data ?? []).map((x: any) => x.name).filter((n: any) => typeof n === 'string') as string[]
        if (names.length === 0) break
        const paths = names.map((n) => `avatars/${n}`)
        const { error: removeError } = await supabase.storage.from('avatars').remove(paths)
        if (removeError) throw removeError
        if (names.length < 100) break
        offset += 100
      }
    }

    await removeAvatarObjects()

    const { error: delProfileError } = await supabase.from('profiles').delete().eq('id', targetUserId)
    if (delProfileError) throw delProfileError

    const { error: delAuthError } = await supabase.auth.admin.deleteUser(targetUserId)
    if (delAuthError) throw delAuthError

    return { success: true as const }
  } catch (err: any) {
    console.error('Admin delete member error:', err)
    return { success: false as const, error: err.message }
  }
}
