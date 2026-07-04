// Server-only private rooms: create with a 6-char code, join by code, and
// per-room standings ranked by coin profit since joining (coins now minus
// bankroll at join time).

import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer } from "@/lib/game";

// No 0/O/1/I: codes get read out loud in group chats.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export interface RoomInfo {
  id: string;
  code: string;
  name: string;
  created_at: string;
  members: number;
}

export interface RoomStanding {
  name: string; // wallet_or_nickname
  coins: number;
  profit: number; // coins - baseline at join
  joined_at: string;
}

function requireDb() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  return supabase;
}

export async function createRoom(identity: string, name: string): Promise<RoomInfo> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);
  const roomName = name.trim().slice(0, 40) || `${identity.slice(0, 12)}'s room`;

  // Codes collide rarely; retry a few times if one does.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const { data: room, error } = await supabase
      .from("rooms")
      .insert({ code, name: roomName, created_by: player.id })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") continue; // code collision: roll again
      throw new Error(`Could not create the room: ${error.message}`);
    }
    await supabase.from("room_members").insert({
      room: room.id,
      player: player.id,
      baseline_coins: player.coins ?? 0,
    });
    return { id: room.id, code: room.code, name: room.name, created_at: room.created_at, members: 1 };
  }
  throw new Error("Could not mint a room code. Try again.");
}

export async function joinRoom(identity: string, code: string): Promise<RoomInfo> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .single();
  if (!room) throw new Error("No room with that code.");

  const { error } = await supabase.from("room_members").insert({
    room: room.id,
    player: player.id,
    baseline_coins: player.coins ?? 0,
  });
  if (error && error.code !== "23505") {
    // 23505 = already a member: joining twice is fine.
    throw new Error(`Could not join: ${error.message}`);
  }

  const { count } = await supabase
    .from("room_members")
    .select("id", { count: "exact", head: true })
    .eq("room", room.id);
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    created_at: room.created_at,
    members: count ?? 1,
  };
}

export async function myRooms(identity: string): Promise<RoomInfo[]> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);
  const { data } = await supabase
    .from("room_members")
    .select("rooms!inner(id, code, name, created_at)")
    .eq("player", player.id)
    .order("joined_at", { ascending: false });
  const rooms = (data ?? []).map((r: any) => r.rooms);
  // Member counts in one pass.
  const out: RoomInfo[] = [];
  for (const room of rooms) {
    const { count } = await supabase
      .from("room_members")
      .select("id", { count: "exact", head: true })
      .eq("room", room.id);
    out.push({ ...room, members: count ?? 1 });
  }
  return out;
}

export async function roomStandings(
  code: string,
): Promise<{ room: RoomInfo; standings: RoomStanding[] }> {
  const supabase = requireDb();
  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .single();
  if (!room) throw new Error("No room with that code.");

  const { data: members } = await supabase
    .from("room_members")
    .select("baseline_coins, joined_at, players!inner(wallet_or_nickname, coins)")
    .eq("room", room.id);

  const standings: RoomStanding[] = (members ?? [])
    .map((m: any) => ({
      name: m.players.wallet_or_nickname as string,
      coins: Number(m.players.coins ?? 0),
      profit: Number(m.players.coins ?? 0) - Number(m.baseline_coins),
      joined_at: m.joined_at as string,
    }))
    .sort((a, b) => b.profit - a.profit || b.coins - a.coins);

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      created_at: room.created_at,
      members: standings.length,
    },
    standings,
  };
}
