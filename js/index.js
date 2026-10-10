const roomGrid = document.getElementById('room-grid');
getRooms().filter(room => window.ahajiAuthorizedRoomIds.has(room.id)).forEach(room => {
  const card = document.createElement('a');
  card.className = 'room-card';
  card.dataset.room = room.id;
  card.href = `gm.html?room=${encodeURIComponent(room.id)}`;
  const img = document.createElement('img');
  img.src = room.thumbnail;
  img.alt = room.name;
  const overlay = document.createElement('div');
  overlay.className = 'room-card-overlay';
  const name = document.createElement('span');
  name.className = 'room-card-name';
  name.textContent = room.name;
  overlay.appendChild(name);
  card.append(img, overlay);
  roomGrid.appendChild(card);
});
if (!roomGrid.children.length) document.getElementById('no-rooms').hidden = false;
