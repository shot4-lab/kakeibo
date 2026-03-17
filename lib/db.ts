import { createClient } from './supabase'

export type Entry = {
  id: string | number;
  name: string;
  amount: number;
  note: string;
  date: string;
  done: boolean;
  group_key: string;
};

export const fetchEntries = async (householdId: string) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('household_id', householdId)
    .order('date', { ascending: false })

  if (error) throw error
  return data
}

export const upsertEntry = async (householdId: string, entry: Partial<Entry>) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('entries')
    .upsert({
      ...entry,
      household_id: householdId,
      updated_at: new Date().toISOString()
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export const deleteEntry = async (entryId: string | number) => {
  const supabase = createClient()
  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('id', entryId)

  if (error) throw error
}

export const getOrCreateProfile = async (userId: string) => {
  const supabase = createClient()
  
  // Try to get profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*, households(*)')
    .eq('id', userId)
    .single()

  if (profile) return profile

  // If no profile, create a default household and profile
  const { data: household, error: hError } = await supabase
    .from('households')
    .insert({ name: 'マイホーム', created_by: userId })
    .select()
    .single()

  if (hError) throw hError

  const { data: newProfile, error: pError } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      household_id: household.id,
      role: 'admin',
      full_name: 'ユーザー',
      share_with_group: true
    })
    .select('*, households(*)')
    .single()

  if (pError) throw pError
  return newProfile
}

export const updateProfile = async (
  userId: string,
  updates: { full_name?: string; avatar_url?: string | null; username?: string; share_with_group?: boolean },
) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('*, households(*)')
    .single()

  if (error) throw error
  return data
}

export const uploadAvatar = async (userId: string, file: File) => {
  const supabase = createClient()
  const fileExt = file.name.split('.').pop()
  const fileName = `${userId}-${Math.random()}.${fileExt}`
  const filePath = `avatars/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file)

  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath)

  return publicUrl
}

export const joinHousehold = async (userId: string, householdId: string) => {
  const supabase = createClient()
  
  // Update profile to point to new household
  const { data, error } = await supabase
    .from('profiles')
    .update({ household_id: householdId, role: 'member' })
    .eq('id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export const getHouseholdMembers = async (householdId: string) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, share_with_group')
    .eq('household_id', householdId)

  if (error) throw error
  return data
}
