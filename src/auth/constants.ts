// Edge-safe constants. The middleware (which runs on the Edge runtime)
// can't import anything that transitively requires Node-only modules like
// `pg` or `next/headers`. Keeping the cookie name here means the
// middleware can read it without dragging in the DB/session machinery.

export const SESSION_COOKIE = 'cg_session';
