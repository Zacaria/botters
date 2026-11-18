import { createHash } from 'node:crypto'
const hash=s=>createHash('sha256').update(s).digest('hex')
export async function removeGameAccount(db,accountId) {
  // The user is already gone; primary authority now denies all of its capabilities.
  // This batch removes live tickets before their referenced tokens and profiles.
  const owned=`SELECT json_extract(value,'$.id') FROM game_records WHERE key LIKE 'session:%' AND json_extract(value,'$.accountId')=?`
  await db.batch([
    db.prepare(`DELETE FROM game_records WHERE key LIKE 'live-ticket:%' AND json_extract(value,'$.tokenKey') IN (SELECT key FROM game_records WHERE key LIKE 'token:%' AND json_extract(value,'$.id') IN (${owned}))`).bind(accountId),
    db.prepare("DELETE FROM game_records WHERE key LIKE 'oauth:grant:%' AND json_extract(value,'$.accountId')=?").bind(accountId),
    db.prepare(`DELETE FROM game_records WHERE key LIKE 'token:%' AND json_extract(value,'$.id') IN (${owned})`).bind(accountId),
    db.prepare("DELETE FROM game_records WHERE key LIKE '%elo:%' AND json_extract(value,'$._owner')=?").bind(hash(accountId)),
    db.prepare(`UPDATE game_records SET value=json_set(value,'$.players',json((SELECT json_group_array(json(CASE WHEN json_extract(p.value,'$.accountId')=? THEN json_set(p.value,'$.name','Deleted player','$.accountId',NULL,'$.session',NULL) ELSE p.value END)) FROM json_each(game_records.value,'$.players') p))) WHERE key LIKE 'match:%' AND EXISTS (SELECT 1 FROM json_each(game_records.value,'$.players') p WHERE json_extract(p.value,'$.accountId')=?)`).bind(accountId,accountId),
    db.prepare("DELETE FROM game_records WHERE key LIKE 'session:%' AND json_extract(value,'$.accountId')=?").bind(accountId),
    db.prepare('DELETE FROM game_records WHERE key=?').bind(`account:${hash(accountId)}`),
  ])
}
