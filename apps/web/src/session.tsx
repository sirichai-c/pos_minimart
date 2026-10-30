import { createContext, useContext } from 'react';
import type { ShiftView, UserView } from '@pos/contracts';

export interface Session {
  user: UserView;
  shift: ShiftView | null;
  refreshShift: () => Promise<void>;
  logout: () => Promise<void>;
  toast: (message: string, tone?: 'ok' | 'error') => void;
  navigate: (page: string) => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('SessionContext missing');
  return s;
}

export const isOwner = (s: Session): boolean => s.user.role === 'owner';
