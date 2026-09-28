import { useState } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Globe, FolderClosed } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { Loading, ErrorNote } from '@/components/ui/empty';
import { apiJson, postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';

// Invite acceptance — the mobile twin of the web `/accept-invite/:id`. Reached
// via deep link (`mobileapp://accept-invite/<id>?token=…`); the invite link the
// worker mints points at the web origin, so most accepts happen there, but this
// keeps in-app parity. Accepting materialises the org membership + project
// grants, then refreshes the account-scoped queries so the newly shared
// projects appear in the switcher.

type Preview = {
  organizationName: string;
  role: string;
  scopeMode: 'all' | 'selection';
  status: string;
};

export default function AcceptInvite() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const [accepting, setAccepting] = useState(false);

  const { data, isPending, isError, refetch } = useQuery<Preview>({
    queryKey: ['invite', id, token],
    queryFn: () => apiJson<Preview>(`/api/orgs/invitations/${id}?token=${encodeURIComponent(token || '')}`),
    retry: false,
  });

  const accept = async () => {
    setAccepting(true);
    try {
      await postJson(`/api/orgs/invitations/${id}/accept`, { token });
      await queryClient.invalidateQueries({ queryKey: ['account'] });
      toast.success('Joined the workspace');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e: any) {
      toast.error(e?.message || 'Could not accept the invitation');
      setAccepting(false);
    }
  };

  if (isPending) return <Loading />;
  if (isError || !data) {
    return <ErrorNote message="This invitation is invalid or expired" onRetry={() => refetch()} />;
  }

  const dead = data.status !== 'pending';

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Users size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>Join {data.organizationName}</Text>
        <View style={styles.scopeRow}>
          <Text style={styles.subtitle}>
            You’re invited as {data.role === 'admin' ? 'an admin' : 'a member'}
          </Text>
          {data.role !== 'admin' &&
            (data.scopeMode === 'all' ? (
              <View style={styles.scopePill}>
                <Globe size={13} color={colors.foreground} />
                <Text style={styles.scopePillText}>all projects</Text>
              </View>
            ) : (
              <View style={styles.scopePill}>
                <FolderClosed size={13} color={colors.foreground} />
                <Text style={styles.scopePillText}>selected projects</Text>
              </View>
            ))}
        </View>
        {dead ? (
          <Text style={styles.subtitle}>This invitation is {data.status}.</Text>
        ) : (
          <Button style={styles.cta} title="Accept invitation" loading={accepting} onPress={accept} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    height: 48,
    width: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${theme.colors.primary}26`,
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '600', color: theme.colors.foreground, textAlign: 'center' },
  scopeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  subtitle: { fontSize: 14, color: theme.colors.mutedForeground, textAlign: 'center' },
  scopePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scopePillText: { fontSize: 14, fontWeight: '500', color: theme.colors.foreground },
  cta: { marginTop: 12, alignSelf: 'stretch' },
}));
