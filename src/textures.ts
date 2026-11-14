export interface TextureManifest {
  board?: string;
  boardNormal?: string;
  boardRoughness?: string;
  boardAO?: string;
  riverLabels?: string;
  pieceAtlas?: string;
  pieces: Partial<Record<`${"red" | "black"}-${string}`, string>>;
}

// Textures ship as WebP. Convert lossless masters with tools/compress-textures.py.
export const textureManifest: TextureManifest = {
  board: "./textures/board-walnut-albedo.webp",
  pieceAtlas: "./textures/xiangqi-pieces-atlas.webp?v=2",
  riverLabels: "./textures/river-labels.webp",
  boardNormal: "./textures/board-walnut-normal.webp",
  boardRoughness: "./textures/board-walnut-roughness.webp",
  boardAO: "./textures/board-walnut-ao.webp",
  pieces: {},
};

export interface PbrTextureSet {
  albedo: string;
  normal: string;
  roughness: string;
  ao: string;
}

export const roomTextureManifest = {
  tatami: {
    albedo: "./textures/tatami-albedo.webp",
    normal: "./textures/tatami-normal.webp",
    roughness: "./textures/tatami-roughness.webp",
    ao: "./textures/tatami-ao.webp",
  },
  paper: {
    albedo: "./textures/shoji-paper-albedo.webp",
    normal: "./textures/shoji-paper-normal.webp",
    roughness: "./textures/shoji-paper-roughness.webp",
    ao: "./textures/shoji-paper-ao.webp",
  },
  plaster: {
    albedo: "./textures/wall-plaster-albedo.webp",
    normal: "./textures/wall-plaster-normal.webp",
    roughness: "./textures/wall-plaster-roughness.webp",
    ao: "./textures/wall-plaster-ao.webp",
  },
  celadon: {
    albedo: "./textures/tea-cup-celadon-albedo.webp",
    normal: "./textures/tea-cup-celadon-normal.webp",
    roughness: "./textures/tea-cup-celadon-roughness.webp",
    ao: "./textures/tea-cup-celadon-ao.webp",
  },
  tableContactAO: "./textures/table-contact-ao.webp",
  teaNormal: "./textures/tea-normal.webp",
};
