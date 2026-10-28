import * as THREE from "/vendor/three.module.js";

export const primitives = [
  { name: "Cube", color: 0xf05d43, create: () => new THREE.BoxGeometry(0.45, 0.45, 0.45) },
  { name: "Sphere", color: 0xf2c84b, create: () => new THREE.SphereGeometry(0.28, 24, 16) },
  { name: "Cone", color: 0x6b91a3, create: () => new THREE.ConeGeometry(0.28, 0.55, 6) },
  { name: "Cylinder", color: 0x7f9b72, create: () => new THREE.CylinderGeometry(0.24, 0.24, 0.5, 16) },
  { name: "Torus", color: 0xb47c9a, create: () => new THREE.TorusGeometry(0.25, 0.09, 12, 24) },
  { name: "Dodecahedron", color: 0xe58a4d, create: () => new THREE.DodecahedronGeometry(0.3) },
  { name: "Icosahedron", color: 0x7d75b8, create: () => new THREE.IcosahedronGeometry(0.3) },
  { name: "Octahedron", color: 0x4d9f91, create: () => new THREE.OctahedronGeometry(0.3) },
];

export function createPrimitive(index) {
  const primitive = primitives[index];
  if (!primitive) throw new Error("A saved object uses an unknown primitive.");
  return new THREE.Mesh(
    primitive.create(),
    new THREE.MeshStandardMaterial({ color: primitive.color, roughness: 0.55 }),
  );
}
