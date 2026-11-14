import * as THREE from "three";

/**
 * Drop-in replacement for THREE.TextureLoader.
 *
 * CHANGE vs. original: the stock loader sets <img>.src = url, which lets the
 * browser issue Range (206 Partial Content) requests on some networks. Here the
 * whole file is fetched in a single request as a Blob, then decoded through an
 * <img> from an object URL. Texture creation (HTMLImageElement source, flipY,
 * color space, mipmaps) is identical to TextureLoader, so callers are unchanged.
 *
 * Progress still flows through the LoadingManager (itemStart/itemEnd/itemError),
 * so the loading overlay driven by DefaultLoadingManager keeps working.
 */
export class FetchTextureLoader extends THREE.TextureLoader {
  override load(
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): THREE.Texture {
    const texture = new THREE.Texture();
    const manager = this.manager;
    const resolved = manager.resolveURL(url);
    manager.itemStart(url);

    const fail = (error: unknown): void => {
      onError?.(error);
      manager.itemError(url);
      manager.itemEnd(url);
    };

    fetch(resolved, { cache: "force-cache", credentials: "same-origin" })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status} ${resolved}`);
        return response.blob();
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          texture.image = image;
          texture.needsUpdate = true;
          onLoad?.(texture);
          manager.itemEnd(url);
        };
        image.onerror = event => {
          URL.revokeObjectURL(objectUrl);
          fail(event);
        };
        image.src = objectUrl;
      })
      .catch(fail);

    return texture;
  }
}
