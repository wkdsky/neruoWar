import * as THREE from 'three';
import { CITY_CHANNEL_TILE_TYPES } from '../cityChannelSchema';

const materialPalette = Object.freeze({
  [CITY_CHANNEL_TILE_TYPES.BASIC_PLATE]: { top: 0xb8b2a4, side: 0x6f6a60 },
  [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE]: { top: 0xd1c8a5, side: 0x817649, emissive: 0x2f2608 },
  [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE]: { top: 0xd4c594, side: 0x7b6d3d, emissive: 0x322500 },
  [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_T_PLATE]: { top: 0xcdbb89, side: 0x75673a, emissive: 0x302500 },
  [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE]: { top: 0xcbb987, side: 0x746438, emissive: 0x2d2400 },
  [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE]: { top: 0xd9c991, side: 0x806f3d, emissive: 0x332600 },
  [CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE]: { top: 0x95b9b7, side: 0x476264, emissive: 0x072f35 },
  [CITY_CHANNEL_TILE_TYPES.ENTRANCE]: { top: 0xb8b2a4, side: 0x6f6a60 },
  [CITY_CHANNEL_TILE_TYPES.EXIT]: { top: 0xb8b2a4, side: 0x6f6a60 }
});

export const createCityChannelThreeMaterials = () => {
  const cache = new Map();

  const getMaterial = (panelType, variant = 'top') => {
    const key = `${panelType || 'default'}:${variant}`;
    if (cache.has(key)) return cache.get(key);
    const palette = materialPalette[panelType] || materialPalette[CITY_CHANNEL_TILE_TYPES.BASIC_PLATE];
    const color = variant === 'side' ? palette.side : palette.top;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0.04,
      emissive: palette.emissive || 0x000000,
      emissiveIntensity: variant === 'side' ? 0.08 : 0.12,
      side: THREE.DoubleSide
    });
    cache.set(key, material);
    return material;
  };

  const dispose = () => {
    cache.forEach((material) => material.dispose());
    cache.clear();
  };

  return {
    getMaterial,
    dispose
  };
};
