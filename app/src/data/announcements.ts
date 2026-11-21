// Expansion packs as they come out: add one here and every player gets a notification (the bell on the home
// page). Newest first. Nothing yet: the first pack is still on the way.
export interface PackAnnouncement {
  id: string;        // never change it: it remembers who has read the notification
  date: string;      // YYYY-MM-DD, the day it came out
  name: string;      // "The Swamp Pack"
  text: string;      // a sentence about what's in it
}

export const PACK_ANNOUNCEMENTS: PackAnnouncement[] = [];
