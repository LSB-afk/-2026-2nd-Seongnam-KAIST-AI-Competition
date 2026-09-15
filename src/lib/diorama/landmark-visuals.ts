import type { Place } from '../places';

export function landmarkTypeIcon(type: string): string {
  if (/박물관|전시/.test(type)) return '🏛';
  if (/공원|숲|식물|수목|산책/.test(type)) return '🌳';
  if (/사찰|절|문화재/.test(type)) return '⛩';
  if (/시장/.test(type)) return '🧺';
  if (/미술|예술|갤러리/.test(type)) return '🎨';
  if (/공연|극장/.test(type)) return '🎭';
  if (/도서|책/.test(type)) return '📚';
  return '📍';
}

/** Uses only the catalog photo; an unavailable photo falls back to a type symbol. */
export function decorateLandmarkButton(button: HTMLButtonElement, place: Place, order?: number): void {
  button.replaceChildren();
  button.className = 'diorama-pin diorama-landmark-pin';
  button.setAttribute('data-landmark-visual', place.photo ? 'photo' : 'type');
  button.setAttribute('data-story-order', order === undefined ? '' : String(order));
  const icon = document.createElement('span');
  icon.className = 'diorama-landmark-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = landmarkTypeIcon(place.type);
  icon.hidden = Boolean(place.photo);
  if (place.photo) {
    const image = document.createElement('img');
    image.className = 'diorama-landmark-photo';
    image.setAttribute('src', place.photo.src);
    image.setAttribute('alt', '');
    image.setAttribute('data-landmark-photo', place.id);
    image.setAttribute('data-captured-at', place.photo.capturedAt ?? '');
    image.setAttribute('data-photo-source', place.photo.sourceUrl);
    image.setAttribute('title', [place.photo.caption, place.photo.capturedAt && `${place.photo.capturedAt} 촬영`, place.photo.author, place.photo.license].filter(Boolean).join(' · '));
    image.loading = 'lazy'; image.decoding = 'async';
    image.onerror = () => { image.hidden = true; icon.hidden = false; button.setAttribute('data-landmark-visual', 'type'); };
    button.appendChild(image);
  }
  button.appendChild(icon);
  const copy = document.createElement('span');
  copy.className = 'diorama-landmark-copy';
  const type = document.createElement('span');
  type.className = 'diorama-landmark-type'; type.textContent = place.type;
  const name = document.createElement('strong'); name.textContent = place.name;
  copy.appendChild(type); copy.appendChild(name); button.appendChild(copy);
  if (order !== undefined) {
    const badge = document.createElement('span');
    badge.className = 'diorama-story-order'; badge.textContent = String(order);
    badge.setAttribute('aria-label', `이야기 ${order}번째 장소`);
    button.appendChild(badge);
  }
}
