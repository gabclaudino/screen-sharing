import { useCallback, useState } from 'react';
import { JoinForm, type JoinParams } from './components/JoinForm';
import { Room } from './components/Room';

type View = { kind: 'join'; notice: string | null } | ({ kind: 'room' } & JoinParams);

export function App() {
  const [view, setView] = useState<View>({ kind: 'join', notice: null });

  const leave = useCallback(
    (notice?: string) => setView({ kind: 'join', notice: notice ?? null }),
    [],
  );

  if (view.kind === 'room') {
    return <Room name={view.name} session={view.session} onLeave={leave} />;
  }
  return (
    <JoinForm notice={view.notice} onJoin={(params) => setView({ kind: 'room', ...params })} />
  );
}
