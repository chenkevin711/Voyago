export type Session = { userId: string; username: string };

const sessions: Record<string, Session> = {};

export function setSession(token: string, session: Session) {
  sessions[token] = session;
}

export function getSession(token: string): Session | undefined {
  return sessions[token];
}

export function deleteSession(token: string) {
  delete sessions[token];
}