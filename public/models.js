import * as THREE from "/vendor/three.module.js";
import { GLTFLoader } from "/vendor/three-examples/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const modelLoads = new Map();
let catalogLoad;

export function getModelCatalog() {
  if (!catalogLoad) {
    catalogLoad = fetch("/model-catalog.json")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the 3D model catalog.");
        const catalog = await response.json();
        if (!Array.isArray(catalog) || !catalog.length || catalog.some((model) =>
          typeof model.name !== "string" ||
          typeof model.category !== "string" ||
          typeof model.url !== "string" ||
          !model.url.startsWith("/3d-assets/")
        )) {
          throw new Error("The 3D model catalog is invalid.");
        }
        return catalog;
      })
      .catch((error) => {
        catalogLoad = null;
        throw error;
      });
  }
  return catalogLoad;
}

export async function createModel(index, catalog) {
  const definition = catalog[index];
  if (!definition) throw new Error("A saved object uses an unknown model.");
  let load = modelLoads.get(index);
  if (!load) {
    load = loader.loadAsync(definition.url);
    modelLoads.set(index, load);
    load.catch(() => modelLoads.delete(index));
  }
  const gltf = await load;
  const asset = gltf.scene.clone(true);
  asset.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(asset);
  if (bounds.isEmpty()) throw new Error(`The ${definition.name} model has no visible geometry.`);

  const size = bounds.getSize(new THREE.Vector3());
  const largestDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
    throw new Error(`The ${definition.name} model has invalid dimensions.`);
  }

  const targetSize = 0.55;
  const normalizationScale = targetSize / largestDimension;
  const center = bounds.getCenter(new THREE.Vector3());
  const normalizedAsset = new THREE.Group();
  normalizedAsset.scale.setScalar(normalizationScale);
  normalizedAsset.position.set(
    -center.x * normalizationScale,
    -bounds.min.y * normalizationScale,
    -center.z * normalizationScale,
  );
  normalizedAsset.add(asset);

  const object = new THREE.Group();
  object.add(normalizedAsset);
  object.userData.arModelIndex = index;
  object.userData.arModelName = definition.name;
  return object;
}
