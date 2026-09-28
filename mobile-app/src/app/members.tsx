import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner-native';
import {
  Check, Globe, FolderClosed, Mail, Share2, Shield, ShieldCheck, Trash2, UserPlus,
} from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Loading, ErrorNote, Empty } from '@/components/ui/empty';
import { apiJson, postJson, deleteJson } from '@/lib/api';
import { useOrgs, type Org, type OrgMember, type OrgInvitation } from '@/lib/queries';
import { useColors } from '@/lib/colors';

// Team & access — the mobile twin of the web `/members` screen. Same
// /api/orgs* endpoints: an org's owner/admin invites people and picks a SCOPE
// per person — the whole workspace ('all' projects, current & future) or a
// hand-picked SELECTION as editor or viewer. Account-scoped (not tied to the
// active project), presented as a formSheet from the header menu.
//
// Invites are delivered by email automatically (worker/lib/email.js); the
// route also returns an inviteUrl which we hand to the OS Share sheet as a
// fallback for the creator.

type ScopeMode = 'all' | 'selection';
type ProjRole = 'editor' | 'viewer';
type OrgProject = { id: string; name: string };

const initials = (m: OrgMember) => (m.name || m.email || '?').trim().charAt(0).toUpperCase();

function scopeSummary(m: OrgMember) {
  if (m.role === 'owner') return 'Owner · full access';
  if (m.role === 'admin') return 'Admin · all projects';
  if (m.allProjects) return 'All projects';
  const n = m.grants?.length || 0;
  return n ? `${n} project${n === 1 ? '' : 's'}` : 'No projects yet';
}

export default function MembersSheet() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data: orgsData, isPending, isError, refetch } = useOrgs();
  const orgs = orgsData?.orgs || [];

  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId && orgs.length) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  const org: Org | null = useMemo(() => orgs.find((o) => o.id === orgId) || null, [orgs, orgId]);
  const canManage = !!org && (org.role === 'owner' || org.role === 'admin');

  const membersQ = useQuery({
    queryKey: ['account', 'org', orgId, 'members'],
    queryFn: () => apiJson<{ members: OrgMember[] }>(`/api/orgs/${orgId}/members`),
    enabled: !!orgId,
  });
  const projectsQ = useQuery({
    queryKey: ['account', 'org', orgId, 'projects'],
    queryFn: () => apiJson<{ projects: OrgProject[] }>(`/api/orgs/${orgId}/projects`),
    enabled: !!orgId && canManage,
    retry: false,
  });
  const invitesQ = useQuery({
    queryKey: ['account', 'org', orgId, 'invitations'],
    queryFn: () => apiJson<{ invitations: OrgInvitation[] }>(`/api/orgs/${orgId}/invitations`),
    enabled: !!orgId && canManage,
    retry: false,
  });

  const members = membersQ.data?.members || [];
  const orgProjects = projectsQ.data?.projects || [];
  const invitations = invitesQ.data?.invitations || [];

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['account', 'org', orgId] });
  };

  // --- Invite form ----------------------------------------------------------
  const [email, setEmail] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('selection');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [projectRole, setProjectRole] = useState<ProjRole>('editor');
  const [inviting, setInviting] = useState(false);

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submitInvite = async () => {
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (!asAdmin && scopeMode === 'selection' && picked.size === 0) {
      toast.error('Pick at least one project, or choose “All projects”');
      return;
    }
    setInviting(true);
    try {
      const res = await postJson<{ inviteUrl: string }>(`/api/orgs/${orgId}/invitations`, {
        email: clean,
        role: asAdmin ? 'admin' : 'member',
        scopeMode: asAdmin ? 'all' : scopeMode,
        projectIds: scopeMode === 'selection' ? [...picked] : [],
        projectRole,
      });
      setEmail('');
      setPicked(new Set());
      setAsAdmin(false);
      reload();
      if (res?.inviteUrl) {
        await Share.share({ message: `Join my workspace on Storyseam: ${res.inviteUrl}` });
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not create invite');
    } finally {
      setInviting(false);
    }
  };

  const setScope = async (memberId: string, patch: Record<string, unknown>) => {
    try {
      await postJson(`/api/orgs/${orgId}/members/${memberId}/scope`, patch);
      reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not update access');
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      await deleteJson(`/api/orgs/${orgId}/members/${memberId}`);
      reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove member');
    }
  };

  const revokeInvite = async (id: string) => {
    try {
      await postJson(`/api/orgs/${orgId}/invitations/${id}/revoke`);
      reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not revoke');
    }
  };

  if (isPending) return <Loading />;
  if (isError) return <ErrorNote message="Could not load your teams" onRetry={() => refetch()} />;
  if (!org) return <Empty title="No workspace yet" hint="Create a project to get started." />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Org switcher */}
      {orgs.length > 1 && (
        <Segmented
          options={orgs.map((o) => ({ value: o.id, label: o.personal ? 'Personal' : o.name }))}
          value={orgId as string}
          onChange={setOrgId}
        />
      )}

      {/* Invite */}
      {canManage && (
        <View style={styles.card}>
          <Eyebrow>Invite someone</Eyebrow>
          <Text style={styles.subtitle}>
            They join {org.name}. Choose how much of it they can see.
          </Text>
          <Input
            placeholder="teammate@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
          <Pressable style={styles.toggleRow} onPress={() => setAsAdmin((v) => !v)}>
            <View style={styles.toggleLabel}>
              <ShieldCheck size={15} color={colors.foreground} />
              <Text style={styles.toggleText}>Make admin (full access)</Text>
            </View>
            <Switch
              value={asAdmin}
              onValueChange={setAsAdmin}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </Pressable>

          {!asAdmin && (
            <>
              <Segmented<ScopeMode>
                style={styles.gap}
                options={[
                  { value: 'all', label: 'All projects' },
                  { value: 'selection', label: 'Selected' },
                ]}
                value={scopeMode}
                onChange={setScopeMode}
              />
              {scopeMode === 'selection' && (
                <View style={styles.pickBox}>
                  <View style={styles.pickHeader}>
                    <Text style={styles.subtitle}>Projects they can open</Text>
                    <Segmented<ProjRole>
                      style={styles.roleToggle}
                      options={[
                        { value: 'editor', label: 'Editor' },
                        { value: 'viewer', label: 'Viewer' },
                      ]}
                      value={projectRole}
                      onChange={setProjectRole}
                    />
                  </View>
                  {orgProjects.length === 0 ? (
                    <Text style={styles.hint}>No projects in this workspace yet.</Text>
                  ) : (
                    orgProjects.map((p) => {
                      const on = picked.has(p.id);
                      return (
                        <Pressable
                          key={p.id}
                          style={({ pressed }) => [styles.pickRow, pressed && styles.rowPressed]}
                          onPress={() => togglePick(p.id)}
                        >
                          <Text style={styles.pickName} numberOfLines={1}>
                            {p.name}
                          </Text>
                          {on ? <Check size={18} color={colors.primary} /> : null}
                        </Pressable>
                      );
                    })
                  )}
                </View>
              )}
            </>
          )}

          <Button
            style={styles.gap}
            title="Create invite"
            loading={inviting}
            onPress={submitInvite}
          >
            <Share2 size={16} color="white" />
          </Button>
        </View>
      )}

      {/* Members */}
      <View style={styles.card}>
        <Eyebrow>Members</Eyebrow>
        {members.map((m) => (
          <View key={m.userId} style={styles.memberRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(m)}</Text>
            </View>
            <View style={styles.memberInfo}>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {m.name || m.email || m.userId}
                </Text>
                {m.role === 'owner' && <Badge label="Owner" variant="muted" />}
                {m.role === 'admin' && <Badge label="Admin" variant="info" />}
              </View>
              <Text style={styles.hint} numberOfLines={1}>
                {scopeSummary(m)}
              </Text>
            </View>
            {canManage && m.role === 'member' && (
              <View style={styles.memberControls}>
                <Switch
                  value={m.allProjects}
                  onValueChange={(v) => setScope(m.userId, { allProjects: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
                <Pressable
                  accessibilityLabel="Remove member"
                  hitSlop={8}
                  onPress={() => removeMember(m.userId)}
                >
                  <Trash2 size={17} color={colors.mutedForeground} />
                </Pressable>
              </View>
            )}
          </View>
        ))}

        {/* Per-project grants for scoped members */}
        {canManage &&
          members.some((m) => m.role === 'member' && !m.allProjects) &&
          orgProjects.length > 0 && (
            <View style={styles.grantsSection}>
              <Eyebrow>Project access</Eyebrow>
              <Text style={styles.subtitle}>
                Give a member specific projects (they don’t have “All projects”).
              </Text>
              {members
                .filter((m) => m.role === 'member' && !m.allProjects)
                .map((m) => {
                  const granted = new Map(m.grants.map((g) => [g.projectId, g.role]));
                  return (
                    <View key={m.userId} style={styles.grantCard}>
                      <Text style={styles.memberName}>{m.name || m.email}</Text>
                      {orgProjects.map((p) => {
                        const role = granted.get(p.id);
                        const on = !!role;
                        return (
                          <View key={p.id} style={styles.grantRow}>
                            <Pressable
                              style={styles.grantToggle}
                              onPress={() =>
                                on
                                  ? setScope(m.userId, { revokeProjectIds: [p.id] })
                                  : setScope(m.userId, { grants: [{ projectId: p.id, role: 'editor' }] })
                              }
                            >
                              <View
                                style={[styles.checkbox, on && styles.checkboxOn]}
                              >
                                {on ? <Check size={13} color="white" /> : null}
                              </View>
                              <Text style={styles.pickName} numberOfLines={1}>
                                {p.name}
                              </Text>
                            </Pressable>
                            {on && (
                              <Pressable
                                hitSlop={6}
                                onPress={() =>
                                  setScope(m.userId, {
                                    grants: [{ projectId: p.id, role: role === 'viewer' ? 'editor' : 'viewer' }],
                                  })
                                }
                              >
                                <Text style={styles.roleTag}>{role === 'viewer' ? 'Viewer' : 'Editor'}</Text>
                              </Pressable>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
            </View>
          )}
      </View>

      {/* Pending invitations */}
      {canManage && invitations.length > 0 && (
        <View style={styles.card}>
          <Eyebrow>Pending invitations</Eyebrow>
          {invitations.map((i) => (
            <View key={i.id} style={styles.inviteRow}>
              <Mail size={15} color={colors.mutedForeground} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {i.email}
                </Text>
                <Text style={styles.hint}>
                  {i.role === 'admin' ? 'Admin' : i.scope_mode === 'all' ? 'All projects' : 'Selected projects'}
                </Text>
              </View>
              <Button size="sm" variant="ghost" title="Revoke" onPress={() => revokeInvite(i.id)} />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48, gap: 16 },
  card: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 16,
    gap: 10,
  },
  subtitle: { fontSize: 13, color: theme.colors.mutedForeground },
  hint: { fontSize: 12, color: theme.colors.mutedForeground },
  gap: { marginTop: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  toggleLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleText: { fontSize: 14, color: theme.colors.foreground },
  pickBox: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
    gap: 6,
  },
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  roleToggle: { width: 150 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  rowPressed: { backgroundColor: theme.colors.secondary },
  pickName: { flex: 1, fontSize: 14, color: theme.colors.foreground },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: {
    height: 34,
    width: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${theme.colors.primary}26`,
  },
  avatarText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  memberInfo: { flex: 1, gap: 2 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { fontSize: 14, fontWeight: '500', color: theme.colors.foreground, flexShrink: 1 },
  memberControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grantsSection: { marginTop: 8, gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 },
  grantCard: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 6,
  },
  grantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  grantToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkbox: {
    height: 20,
    width: 20,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  roleTag: { fontSize: 12, color: theme.colors.mutedForeground },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
}));
