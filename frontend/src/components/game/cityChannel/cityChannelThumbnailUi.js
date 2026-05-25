import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

export const THUMBNAIL_NEAR_CURSOR_DISTANCE_PX = 80;

export const isCityChannelThumbnailInteractionLocked = ({
  activeTool,
  activeTileType,
  activeComponentType,
  carryActive = false
} = {}) => (
  (activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!activeTileType)
  || (activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && !!activeComponentType)
  || !!carryActive
);

export const getDistanceToBoundingRect = (clientX, clientY, rect) => {
  if (!rect) return Infinity;
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return Math.hypot(dx, dy);
};

export const isPointerNearThumbnail = (
  clientX,
  clientY,
  rect,
  distance = THUMBNAIL_NEAR_CURSOR_DISTANCE_PX
) => getDistanceToBoundingRect(clientX, clientY, rect) <= distance;

export const getCityChannelThumbnailClassName = ({
  isOpen = true,
  isLocked = false,
  isNearCursor = false
} = {}) => [
  'city-channel-thumbnail',
  isOpen ? 'is-open' : 'is-closed',
  isLocked ? 'is-interaction-locked' : '',
  isLocked && isNearCursor ? 'is-near-cursor' : ''
].filter(Boolean).join(' ');
