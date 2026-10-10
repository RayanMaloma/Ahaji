import { createRoomRepository } from './room-repository.mjs';

// The database remains the authority. This module has no credentials and
// never substitutes static room configuration for a failed network read.
export function createAdminRepository(client) {
  const rooms = createRoomRepository(client);

  async function load() {
    const [roomRows, directory] = await Promise.all([
      rooms.listRooms({ includeInactive: true }),
      client.rpc('admin_staff_directory')
    ]);
    if (directory.error) throw new Error(directory.error.message || 'Staff directory request failed.');
    return { rooms: roomRows, staff: directory.data || [] };
  }

  return Object.freeze({ load });
}
