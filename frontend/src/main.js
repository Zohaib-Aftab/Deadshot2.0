import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { io } from 'socket.io-client';

// --- Scene, Camera, and Renderer ---
const scene = new THREE.Scene();

// Sky color and atmospheric fog
const skyColor = new THREE.Color(0x87ceeb);
scene.background = skyColor;
scene.fog = new THREE.Fog(0x87ceeb, 30, 120);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 1.8, 20); // Player eye height

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- Proper Lighting ---
// Ambient light for base illumination
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

// Hemisphere light for natural sky/ground bounce
const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x3b3a30, 0.55);
scene.add(hemiLight);

// Directional sunlight with shadows
const sunLight = new THREE.DirectionalLight(0xfffaed, 1.35);
sunLight.position.set(35, 45, 25);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 150;
const d = 55;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// --- Texture Generators ---
function createProceduralNoiseCanvas(width, height, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, width, height);
  return canvas;
}

// Floor Grid Texture (tactical concrete tile grid)
const floorCanvas = createProceduralNoiseCanvas(512, 512, (ctx, w, h) => {
  // Base slab color
  ctx.fillStyle = '#21262d';
  ctx.fillRect(0, 0, w, h);

  // Concrete speckles/noise
  for (let i = 0; i < 8000; i++) {
    const n = Math.random() * 255;
    ctx.fillStyle = `rgba(${n}, ${n}, ${n}, 0.04)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }

  // Sub-grid lines
  ctx.strokeStyle = '#2d3542';
  ctx.lineWidth = 2;
  const step = w / 4;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Outer primary tile border
  ctx.strokeStyle = '#4e5b70';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  // Subtle corner cross-markers
  ctx.fillStyle = '#64748b';
  const markSize = 12;
  ctx.fillRect(8, 8, markSize, 2);
  ctx.fillRect(8, 8, 2, markSize);
  ctx.fillRect(w - 8 - markSize, 8, markSize, 2);
  ctx.fillRect(w - 10, 8, 2, markSize);
  ctx.fillRect(8, h - 10, markSize, 2);
  ctx.fillRect(8, h - 8 - markSize, 2, markSize);
  ctx.fillRect(w - 8 - markSize, h - 10, markSize, 2);
  ctx.fillRect(w - 10, h - 8 - markSize, 2, markSize);
});

const floorTexture = new THREE.CanvasTexture(floorCanvas);
floorTexture.wrapS = THREE.RepeatWrapping;
floorTexture.wrapT = THREE.RepeatWrapping;
floorTexture.repeat.set(25, 25);

// Concrete Cover Box Texture
const concreteCanvas = createProceduralNoiseCanvas(512, 512, (ctx, w, h) => {
  // Concrete base
  ctx.fillStyle = '#7a818c';
  ctx.fillRect(0, 0, w, h);

  // Heavy concrete noise and texture grain
  for (let i = 0; i < 15000; i++) {
    const val = Math.floor(Math.random() * 60) - 30;
    const baseVal = 125 + val;
    ctx.fillStyle = `rgba(${baseVal}, ${baseVal}, ${baseVal}, 0.15)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }

  // Weathering streaks
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(40, 45, 50, 0.08)';
    const sx = Math.random() * w;
    const sy = Math.random() * h;
    ctx.fillRect(sx, sy, 3 + Math.random() * 5, 20 + Math.random() * 60);
  }

  // Reinforced panel beveled edges
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  ctx.strokeStyle = 'rgba(20, 24, 30, 0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // Corner steel bolts
  const boltPositions = [
    [24, 24],
    [w - 24, 24],
    [24, h - 24],
    [w - 24, h - 24],
  ];
  boltPositions.forEach(([bx, by]) => {
    ctx.fillStyle = '#2b3038';
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#abb2bf';
    ctx.beginPath();
    ctx.arc(bx - 1, by - 1, 4, 0, Math.PI * 2);
    ctx.fill();
  });
});

const concreteTexture = new THREE.CanvasTexture(concreteCanvas);

// --- Large Textured Floor Grid ---
const floorSize = 100;
const floorGeometry = new THREE.PlaneGeometry(floorSize, floorSize);
const floorMaterial = new THREE.MeshStandardMaterial({
  map: floorTexture,
  roughness: 0.82,
  metalness: 0.12,
});
const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

// Optional subtle 3D grid line helper for extra clarity
const gridHelper = new THREE.GridHelper(floorSize, 50, 0x00ffcc, 0x334455);
gridHelper.position.y = 0.01; // slightly above plane to avoid z-fighting
scene.add(gridHelper);

// --- 4 Outer Boundary Walls & Colliders ---
const colliders = [];
const shootables = [floorMesh];

const wallHeight = 6;
const wallThickness = 1.2;
const wallMaterial = new THREE.MeshStandardMaterial({
  map: concreteTexture,
  roughness: 0.88,
  metalness: 0.15,
  color: 0x8b939e,
});

const walls = [
  // North Wall
  { size: [floorSize + wallThickness, wallHeight, wallThickness], pos: [0, wallHeight / 2, -floorSize / 2] },
  // South Wall
  { size: [floorSize + wallThickness, wallHeight, wallThickness], pos: [0, wallHeight / 2, floorSize / 2] },
  // West Wall
  { size: [wallThickness, wallHeight, floorSize + wallThickness], pos: [-floorSize / 2, wallHeight / 2, 0] },
  // East Wall
  { size: [wallThickness, wallHeight, floorSize + wallThickness], pos: [floorSize / 2, wallHeight / 2, 0] },
];

walls.forEach(({ size, pos }) => {
  const wallGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const wallMesh = new THREE.Mesh(wallGeo, wallMaterial);
  wallMesh.position.set(pos[0], pos[1], pos[2]);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);

  wallMesh.updateMatrixWorld(true);
  colliders.push(new THREE.Box3().setFromObject(wallMesh));
  shootables.push(wallMesh);
});

// --- 5 to 6 Scattered Concrete-Style Boxes to Act as Cover ---
const coverBoxConfigs = [
  { size: [5.0, 3.2, 2.8], pos: [-12, 1.6, -8] },
  { size: [3.4, 3.0, 3.4], pos: [14, 1.5, -12] },
  { size: [2.6, 2.6, 6.2], pos: [-15, 1.3, 14] },
  { size: [4.0, 3.8, 3.0], pos: [12, 1.9, 12] },
  { size: [7.0, 2.8, 2.2], pos: [0, 1.4, -20] },
  { size: [3.2, 2.5, 4.8], pos: [3, 1.25, 5] },
];

const coverBoxes = [];
const boxMaterial = new THREE.MeshStandardMaterial({
  map: concreteTexture,
  roughness: 0.85,
  metalness: 0.18,
});

coverBoxConfigs.forEach(({ size, pos }) => {
  const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const boxMesh = new THREE.Mesh(boxGeo, boxMaterial);
  boxMesh.position.set(pos[0], pos[1], pos[2]);
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  scene.add(boxMesh);

  boxMesh.updateMatrixWorld(true);
  colliders.push(new THREE.Box3().setFromObject(boxMesh));
  coverBoxes.push(boxMesh);
  shootables.push(boxMesh);
});

// --- Reusable 3D Humanoid Soldier Character Builder ---
function createNameTagTexture(nickname) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background rounded badge with neon cyan border
  ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
  ctx.shadowBlur = 14;

  ctx.fillStyle = 'rgba(11, 15, 25, 0.88)';
  const x = 32, y = 16, w = 448, h = 96, radius = 24;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Nickname text
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px "Rajdhani", "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((nickname || 'SOLDIER').toUpperCase(), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

class Soldier {
  constructor(id, initialData = {}) {
    this.id = id;
    this.nickname = initialData.nickname || `Player_${id.substring(0, 4)}`;
    this.hp = initialData.health !== undefined ? initialData.health : 100;
    this.maxHp = 100;
    this.isAlive = true;
    this.flashTimer = 0;

    // Movement interpolation targets
    this.targetPosition = new THREE.Vector3(
      initialData.position?.x || 0,
      initialData.position?.y || 0,
      initialData.position?.z || 0
    );
    this.targetRotationY = (typeof initialData.rotation === 'number') 
      ? initialData.rotation 
      : (initialData.rotation?.y || 0);

    // Main group
    this.group = new THREE.Group();
    this.group.position.copy(this.targetPosition);
    this.group.rotation.y = this.targetRotationY;

    // Per-soldier materials for independent hit flashes
    this.matSuit = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.75, metalness: 0.1 });
    this.matVest = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.5, metalness: 0.3 });
    this.matHelmet = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.4 });
    this.matVisor = new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.2, metalness: 0.9, emissive: 0x00a3cc, emissiveIntensity: 0.7 });
    this.matSkin = new THREE.MeshStandardMaterial({ color: 0x242831, roughness: 0.8 });
    this.matBoots = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8, metalness: 0.2 });
    this.matGunMetal = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.35, metalness: 0.85 });
    this.matGunPolymer = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.7, metalness: 0.2 });

    this.hitboxes = [];
    this.walkCycle = Math.random() * Math.PI * 2;

    // --- 1. HEAD & HELMET ---
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.58, 0);

    // Head base (balaclava)
    const headGeo = new THREE.BoxGeometry(0.24, 0.26, 0.24);
    this.headMesh = new THREE.Mesh(headGeo, this.matSkin);
    this.headMesh.castShadow = true;
    this.headMesh.receiveShadow = true;
    this.headGroup.add(this.headMesh);

    // Tactical Helmet
    const helmetGeo = new THREE.BoxGeometry(0.28, 0.15, 0.28);
    const helmetMesh = new THREE.Mesh(helmetGeo, this.matHelmet);
    helmetMesh.position.set(0, 0.08, 0);
    helmetMesh.castShadow = true;
    this.headGroup.add(helmetMesh);

    // Helmet Brim
    const brimGeo = new THREE.BoxGeometry(0.29, 0.04, 0.08);
    const brimMesh = new THREE.Mesh(brimGeo, this.matHelmet);
    brimMesh.position.set(0, 0.02, 0.14);
    this.headGroup.add(brimMesh);

    // Glowing Tactical Visor
    const visorGeo = new THREE.BoxGeometry(0.22, 0.065, 0.04);
    const visorMesh = new THREE.Mesh(visorGeo, this.matVisor);
    visorMesh.position.set(0, 0.01, 0.135);
    this.headGroup.add(visorMesh);

    this.headMesh.userData = { player: this, part: 'head' };
    helmetMesh.userData = { player: this, part: 'head' };
    brimMesh.userData = { player: this, part: 'head' };
    visorMesh.userData = { player: this, part: 'head' };
    this.hitboxes.push(this.headMesh, helmetMesh, brimMesh, visorMesh);
    this.group.add(this.headGroup);

    // --- 2. TACTICAL TORSO / BODY ---
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 1.10, 0);

    // Combat shirt / inner torso
    const torsoGeo = new THREE.BoxGeometry(0.40, 0.48, 0.24);
    this.torsoMesh = new THREE.Mesh(torsoGeo, this.matSuit);
    this.torsoMesh.castShadow = true;
    this.torsoMesh.receiveShadow = true;
    this.torsoGroup.add(this.torsoMesh);

    // Heavy Tactical Vest / Plate Carrier
    const vestGeo = new THREE.BoxGeometry(0.44, 0.40, 0.28);
    const vestMesh = new THREE.Mesh(vestGeo, this.matVest);
    vestMesh.position.set(0, 0.02, 0);
    vestMesh.castShadow = true;
    this.torsoGroup.add(vestMesh);

    // Magazine pouches on vest
    for (let i = -1; i <= 1; i++) {
      const pouchGeo = new THREE.BoxGeometry(0.08, 0.14, 0.06);
      const pouchMesh = new THREE.Mesh(pouchGeo, this.matHelmet);
      pouchMesh.position.set(i * 0.11, -0.05, 0.16);
      this.torsoGroup.add(pouchMesh);
    }

    // Shoulder Armor
    const shoulderGeo = new THREE.BoxGeometry(0.12, 0.12, 0.18);
    const leftShoulder = new THREE.Mesh(shoulderGeo, this.matVest);
    leftShoulder.position.set(-0.25, 0.18, 0);
    const rightShoulder = new THREE.Mesh(shoulderGeo, this.matVest);
    rightShoulder.position.set(0.25, 0.18, 0);
    this.torsoGroup.add(leftShoulder, rightShoulder);

    this.torsoMesh.userData = { player: this, part: 'body' };
    vestMesh.userData = { player: this, part: 'body' };
    leftShoulder.userData = { player: this, part: 'body' };
    rightShoulder.userData = { player: this, part: 'body' };
    this.hitboxes.push(this.torsoMesh, vestMesh, leftShoulder, rightShoulder);
    this.group.add(this.torsoGroup);

    // --- 3. LEFT AND RIGHT ARMS HOLDING A RIFLE ---
    this.armsGroup = new THREE.Group();
    this.armsGroup.position.set(0, 1.20, 0);

    // Right Arm (Trigger hand, angled forward)
    const rightArmGeo = new THREE.BoxGeometry(0.12, 0.42, 0.13);
    const rightArm = new THREE.Mesh(rightArmGeo, this.matSuit);
    rightArm.position.set(0.26, -0.06, 0.08);
    rightArm.rotation.set(-Math.PI * 0.32, 0.1, -0.15);
    rightArm.castShadow = true;
    this.armsGroup.add(rightArm);

    // Left Arm (Supporting barrel hand, angled across)
    const leftArmGeo = new THREE.BoxGeometry(0.12, 0.44, 0.13);
    const leftArm = new THREE.Mesh(leftArmGeo, this.matSuit);
    leftArm.position.set(-0.22, -0.06, 0.16);
    leftArm.rotation.set(-Math.PI * 0.38, -0.28, 0.32);
    leftArm.castShadow = true;
    this.armsGroup.add(leftArm);

    rightArm.userData = { player: this, part: 'arms' };
    leftArm.userData = { player: this, part: 'arms' };
    this.hitboxes.push(rightArm, leftArm);

    // Miniature Assault Rifle in hands
    const rifleGroup = new THREE.Group();
    rifleGroup.position.set(0.08, -0.14, 0.30);
    rifleGroup.rotation.set(-0.08, 0, 0);

    const rReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.35), this.matGunMetal);
    const rBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8), this.matGunMetal);
    rBarrel.rotation.x = Math.PI / 2;
    rBarrel.position.set(0, 0.01, 0.32);
    const rMag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.08), this.matGunPolymer);
    rMag.position.set(0, -0.09, 0.05);
    rMag.rotation.x = 0.2;
    const rStock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.18), this.matGunPolymer);
    rStock.position.set(0, -0.01, -0.24);

    rifleGroup.add(rReceiver, rBarrel, rMag, rStock);
    this.armsGroup.add(rifleGroup);
    this.group.add(this.armsGroup);

    // --- 4. LEFT AND RIGHT LEGS (Hinged at Hip for Walking Swing) ---
    const legGeo = new THREE.BoxGeometry(0.16, 0.68, 0.18);
    const bootGeo = new THREE.BoxGeometry(0.18, 0.16, 0.25);

    // Left Leg Group (hip pivot at y = 0.82)
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.13, 0.82, 0);

    const leftLeg = new THREE.Mesh(legGeo, this.matSuit);
    leftLeg.position.set(0, -0.34, 0);
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;

    const leftBoot = new THREE.Mesh(bootGeo, this.matBoots);
    leftBoot.position.set(0, -0.73, 0.03);
    leftBoot.castShadow = true;

    this.leftLegGroup.add(leftLeg, leftBoot);
    this.group.add(this.leftLegGroup);

    // Right Leg Group (hip pivot at y = 0.82)
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.13, 0.82, 0);

    const rightLeg = new THREE.Mesh(legGeo, this.matSuit);
    rightLeg.position.set(0, -0.34, 0);
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;

    const rightBoot = new THREE.Mesh(bootGeo, this.matBoots);
    rightBoot.position.set(0, -0.73, 0.03);
    rightBoot.castShadow = true;

    this.rightLegGroup.add(rightLeg, rightBoot);
    this.group.add(this.rightLegGroup);

    // Legs hitbox
    this.legsHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.85, 0.26),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.legsHitbox.position.set(0, 0.42, 0);
    leftLeg.userData = { player: this, part: 'legs' };
    leftBoot.userData = { player: this, part: 'legs' };
    rightLeg.userData = { player: this, part: 'legs' };
    rightBoot.userData = { player: this, part: 'legs' };
    this.legsHitbox.userData = { player: this, part: 'legs' };
    this.hitboxes.push(leftLeg, leftBoot, rightLeg, rightBoot, this.legsHitbox);
    this.group.add(this.legsHitbox);

    // --- 5. FLOATING NAME TAG & HEALTH BAR ---
    this.billboardGroup = new THREE.Group();
    this.billboardGroup.position.set(0, 2.05, 0);

    const barW = 0.85;
    const barH = 0.09;
    const barBgMat = new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide, depthTest: false });
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(barW + 0.04, barH + 0.04), barBgMat);
    this.billboardGroup.add(barBg);

    const barRedMat = new THREE.MeshBasicMaterial({ color: 0x450a0a, side: THREE.DoubleSide, depthTest: false });
    const barRed = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), barRedMat);
    barRed.position.z = 0.001;
    this.billboardGroup.add(barRed);

    this.barFillMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide, depthTest: false });
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), this.barFillMat);
    this.barFill.position.z = 0.002;
    this.barW = barW;
    this.billboardGroup.add(this.barFill);

    this.nameTagMat = new THREE.MeshBasicMaterial({
      map: createNameTagTexture(this.nickname),
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false
    });
    this.nameTagMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.30), this.nameTagMat);
    this.nameTagMesh.position.set(0, 0.24, 0.003);
    this.billboardGroup.add(this.nameTagMesh);

    this.group.add(this.billboardGroup);

    // Add soldier to scene
    scene.add(this.group);

    // Register hitboxes in shootables
    this.hitboxes.forEach((m) => shootables.push(m));

    // Bounding box collider
    this.boxCollider = new THREE.Box3();
    this.updateCollider();
    colliders.push(this.boxCollider);

    this.updateHealthBar();
  }

  setNickname(nickname) {
    this.nickname = nickname;
    if (this.nameTagMat.map) this.nameTagMat.map.dispose();
    this.nameTagMat.map = createNameTagTexture(nickname);
    this.nameTagMat.needsUpdate = true;
  }

  updateHealthBar() {
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.barFill.scale.x = ratio;
    this.barFill.position.x = -(this.barW / 2) * (1 - ratio);

    if (ratio > 0.5) {
      this.barFillMat.color.setHex(0x22c55e); // Green
    } else if (ratio > 0.25) {
      this.barFillMat.color.setHex(0xf59e0b); // Orange
    } else {
      this.barFillMat.color.setHex(0xef4444); // Red
    }
  }

  setHealth(hp) {
    this.hp = hp;
    this.updateHealthBar();
    if (this.hp <= 0 && this.isAlive) {
      this.die();
    }
  }

  flashHit() {
    this.matSuit.color.setHex(0xffffff);
    this.matSuit.emissive.setHex(0xffffff);
    this.matVest.color.setHex(0xffffff);
    this.matVest.emissive.setHex(0xffffff);
    this.matHelmet.color.setHex(0xffffff);
    this.matHelmet.emissive.setHex(0xffffff);
    this.flashTimer = 0.12;
  }

  die() {
    this.isAlive = false;
    this.group.visible = false;
    this.leftLegGroup.rotation.x = 0;
    this.rightLegGroup.rotation.x = 0;
    this.hitboxes.forEach((m) => {
      const idx = shootables.indexOf(m);
      if (idx !== -1) shootables.splice(idx, 1);
    });
    this.boxCollider.min.set(0, -999, 0);
    this.boxCollider.max.set(0, -998, 0);
    spawnDeathParticles(this.group.position.clone().add(new THREE.Vector3(0, 1.0, 0)));
  }

  respawn(pos) {
    if (pos) {
      this.targetPosition.set(pos.x, pos.y, pos.z);
      this.group.position.copy(this.targetPosition);
    }
    this.hp = this.maxHp;
    this.updateHealthBar();
    this.isAlive = true;
    this.group.visible = true;
    this.leftLegGroup.rotation.x = 0;
    this.rightLegGroup.rotation.x = 0;
    this.hitboxes.forEach((m) => {
      if (!shootables.includes(m)) shootables.push(m);
    });
    this.updateCollider();
  }

  destroy() {
    scene.remove(this.group);
    this.hitboxes.forEach((m) => {
      const idx = shootables.indexOf(m);
      if (idx !== -1) shootables.splice(idx, 1);
    });
    const colIdx = colliders.indexOf(this.boxCollider);
    if (colIdx !== -1) colliders.splice(colIdx, 1);
  }

  updateCollider() {
    this.boxCollider.min.set(this.group.position.x - 0.45, this.group.position.y, this.group.position.z - 0.45);
    this.boxCollider.max.set(this.group.position.x + 0.45, this.group.position.y + 1.95, this.group.position.z + 0.45);
  }

  updateTransform(pos, rot) {
    if (pos) {
      this.targetPosition.set(pos.x, pos.y, pos.z);
      // Snap instantly if far away to avoid sliding across whole arena
      if (this.group.position.distanceTo(this.targetPosition) > 12) {
        this.group.position.copy(this.targetPosition);
      }
    }
    if (rot !== undefined) {
      this.targetRotationY = typeof rot === 'object' ? (rot.y || 0) : rot;
    }
  }

  update(delta) {
    if (!this.isAlive) return;

    // Track horizontal displacement for walking leg-swing animation
    const prevX = this.group.position.x;
    const prevZ = this.group.position.z;

    // Smooth position lerp
    this.group.position.lerp(this.targetPosition, Math.min(delta * 14, 1));

    // Smooth shortest-angle rotation interpolation
    const diffRot = (this.targetRotationY - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    this.group.rotation.y += diffRot * Math.min(delta * 16, 1);

    // Calculate movement speed & distance to target
    const distMoved = Math.hypot(this.group.position.x - prevX, this.group.position.z - prevZ);
    const speed = distMoved / Math.max(delta, 0.0001);
    const distToTarget = Math.hypot(this.targetPosition.x - this.group.position.x, this.targetPosition.z - this.group.position.z);

    const isMoving = (speed > 0.08 || distToTarget > 0.08);

    if (isMoving) {
      // Walking leg-swing animation
      const stepFreq = Math.min(speed * 2.2 + 6.0, 14.0);
      this.walkCycle += delta * stepFreq;

      const swing = Math.sin(this.walkCycle) * 0.52;
      this.leftLegGroup.rotation.x = swing;
      this.rightLegGroup.rotation.x = -swing;

      // Natural vertical step bounce on torso, head, and rifle
      const bounce = Math.abs(Math.sin(this.walkCycle)) * 0.025;
      this.torsoGroup.position.y = 1.10 + bounce;
      this.headGroup.position.y = 1.58 + bounce;
      this.armsGroup.position.y = 1.20 + bounce;
      this.armsGroup.rotation.z = Math.sin(this.walkCycle) * 0.02;
    } else {
      // Smoothly return to resting idle stance
      this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(this.leftLegGroup.rotation.x, 0, delta * 12);
      this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(this.rightLegGroup.rotation.x, 0, delta * 12);
      this.torsoGroup.position.y = THREE.MathUtils.lerp(this.torsoGroup.position.y, 1.10, delta * 12);
      this.headGroup.position.y = THREE.MathUtils.lerp(this.headGroup.position.y, 1.58, delta * 12);
      this.armsGroup.position.y = THREE.MathUtils.lerp(this.armsGroup.position.y, 1.20, delta * 12);
      this.armsGroup.rotation.z = THREE.MathUtils.lerp(this.armsGroup.rotation.z, 0, delta * 12);
    }

    this.updateCollider();

    // Reset hit flash
    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0) {
        this.matSuit.color.setHex(0x1f2937);
        this.matSuit.emissive.setHex(0x000000);
        this.matVest.color.setHex(0x374151);
        this.matVest.emissive.setHex(0x000000);
        this.matHelmet.color.setHex(0x111827);
        this.matHelmet.emissive.setHex(0x000000);
      }
    }

    // Billboard name tag & health bar directly toward player camera
    this.billboardGroup.quaternion.copy(camera.quaternion);
  }
}

// Remote players map
const remotePlayers = new Map();
let socket = null;

// Kill feed, elimination banner & death screen UI elements
const killFeedEl = document.getElementById('kill-feed');
const elimBannerEl = document.getElementById('elim-banner');
const elimPlayerNameEl = document.getElementById('elim-player-name');
const deathOverlayEl = document.getElementById('death-overlay');
const deathKillerInfoEl = document.getElementById('death-killer-info');
const deathCountdownEl = document.getElementById('death-countdown');

let elimTimeout = null;
function showEliminationBanner(victimName) {
  if (!elimBannerEl) return;
  if (elimPlayerNameEl) elimPlayerNameEl.textContent = victimName;
  elimBannerEl.classList.remove('active');
  void elimBannerEl.offsetWidth;
  elimBannerEl.classList.add('active');
  if (elimTimeout) clearTimeout(elimTimeout);
  elimTimeout = setTimeout(() => {
    elimBannerEl.classList.remove('active');
  }, 1600);
}

function addKillFeed(killerName, victimName, isHeadshot) {
  if (!killFeedEl) return;
  const item = document.createElement('div');
  item.className = `kill-feed-item ${isHeadshot ? 'headshot' : ''}`;
  item.innerHTML = `
    <span class="kf-killer">${killerName}</span>
    <span class="kf-icon">🎯</span>
    <span class="kf-victim">${victimName}</span>
    ${isHeadshot ? '<span class="kf-headshot">HEADSHOT</span>' : ''}
  `;
  killFeedEl.appendChild(item);

  while (killFeedEl.children.length > 5) {
    killFeedEl.removeChild(killFeedEl.firstChild);
  }

  setTimeout(() => {
    item.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    item.style.opacity = '0';
    item.style.transform = 'skewX(-8deg) translateX(30px)';
    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 400);
  }, 3200);
}

let deathCountdownInterval = null;
function showDeathScreen(killerName) {
  if (!deathOverlayEl) return;
  if (deathKillerInfoEl) deathKillerInfoEl.textContent = `ELIMINATED BY ${killerName.toUpperCase()}`;
  deathOverlayEl.classList.add('active');

  let remaining = 2;
  if (deathCountdownEl) deathCountdownEl.textContent = `RESPAWNING IN ${remaining}s...`;

  if (deathCountdownInterval) clearInterval(deathCountdownInterval);
  deathCountdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(deathCountdownInterval);
      if (deathCountdownEl) deathCountdownEl.textContent = 'DEPLOYING...';
    } else {
      if (deathCountdownEl) deathCountdownEl.textContent = `RESPAWNING IN ${remaining}s...`;
    }
  }, 1000);
}

function hideDeathScreen() {
  if (deathOverlayEl) deathOverlayEl.classList.remove('active');
  if (deathCountdownInterval) clearInterval(deathCountdownInterval);
}

function initMultiplayer(nickname) {
  if (socket && socket.connected) {
    socket.emit('setNickname', nickname);
    return;
  }

  socket = io('http://localhost:3000', {
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('[MULTIPLAYER] Connected to server as:', socket.id);
    socket.emit('setNickname', nickname);
  });

  socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
      if (id !== socket.id && !remotePlayers.has(id)) {
        const soldier = new Soldier(id, players[id]);
        remotePlayers.set(id, soldier);
      }
    });
  });

  socket.on('playerJoined', (playerData) => {
    if (playerData.id !== socket.id && !remotePlayers.has(playerData.id)) {
      console.log('[MULTIPLAYER] Player joined:', playerData.nickname);
      const soldier = new Soldier(playerData.id, playerData);
      remotePlayers.set(playerData.id, soldier);
    }
  });

  socket.on('playerMoved', (data) => {
    const soldier = remotePlayers.get(data.id);
    if (soldier) {
      soldier.updateTransform(data.position, data.rotation);
    }
  });

  socket.on('playerUpdated', (data) => {
    const soldier = remotePlayers.get(data.id);
    if (soldier && data.nickname) {
      soldier.setNickname(data.nickname);
    }
  });

  // Handle real-time health synchronization from server
  socket.on('playerHealthUpdated', (data) => {
    if (data.id === socket.id) {
      playerHealth = data.health;
      updateHealthHUD();
    } else {
      const soldier = remotePlayers.get(data.id);
      if (soldier) {
        soldier.setHealth(data.health);
        soldier.flashHit();
      }
    }
  });

  socket.on('playerDamaged', (data) => {
    if (data.id === socket.id) {
      playerHealth = data.health;
      updateHealthHUD();
    } else {
      const soldier = remotePlayers.get(data.id);
      if (soldier) {
        soldier.setHealth(data.health);
        soldier.flashHit();
      }
    }
  });

  // Handle kill notification broadcast from server
  socket.on('killNotification', (data) => {
    addKillFeed(data.killerName, data.victimName, data.isHeadshot);

    // If local player scored the elimination
    if (data.killerId === socket.id) {
      kills = data.killerKills !== undefined ? data.killerKills : kills + 1;
      if (killsValueEl) killsValueEl.textContent = kills;
      showEliminationBanner(data.victimName);
    }

    // If local player was defeated
    if (data.victimId === socket.id) {
      playerHealth = 0;
      updateHealthHUD();
      showDeathScreen(data.killerName);
    } else {
      const soldier = remotePlayers.get(data.victimId);
      if (soldier) {
        soldier.die();
      }
    }
  });

  socket.on('playerKilled', (data) => {
    const soldier = remotePlayers.get(data.victimId);
    if (soldier) {
      soldier.die();
    }
  });

  // Handle player respawn (safe point after 2 seconds)
  socket.on('playerRespawned', (data) => {
    if (data.id === socket.id) {
      hideDeathScreen();
      playerHealth = 100;
      updateHealthHUD();
      camera.position.set(data.position.x, data.position.y + playerHeight, data.position.z);
      velocity.set(0, 0, 0);
    } else {
      const soldier = remotePlayers.get(data.id);
      if (soldier) {
        soldier.respawn(data.position);
      }
    }
  });

  socket.on('playerDisconnected', (id) => {
    console.log('[MULTIPLAYER] Player disconnected:', id);
    const soldier = remotePlayers.get(id);
    if (soldier) {
      soldier.destroy();
      remotePlayers.delete(id);
    }
  });

  socket.on('stateUpdate', (players) => {
    Object.keys(players).forEach((id) => {
      if (id !== socket.id) {
        let soldier = remotePlayers.get(id);
        if (!soldier) {
          soldier = new Soldier(id, players[id]);
          remotePlayers.set(id, soldier);
        } else {
          soldier.updateTransform(players[id].position, players[id].rotation);
          if (soldier.hp !== players[id].health) {
            soldier.setHealth(players[id].health);
          }
        }
      }
    });

    remotePlayers.forEach((soldier, id) => {
      if (!players[id]) {
        soldier.destroy();
        remotePlayers.delete(id);
      }
    });
  });
}

// --- Local Player Transform Synchronization ---
let lastEmittedX = null;
let lastEmittedY = null;
let lastEmittedZ = null;
let lastEmittedYaw = null;
let lastEmitTime = 0;

function emitLocalTransform(force = false) {
  if (!socket || !socket.connected || !controls.isLocked) return;

  const now = performance.now();
  // Max 60Hz limit unless forced
  if (!force && now - lastEmitTime < 16) return;

  const feetY = Number((camera.position.y - playerHeight).toFixed(3));
  const posX = Number(camera.position.x.toFixed(3));
  const posZ = Number(camera.position.z.toFixed(3));

  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const yaw = Number(Math.atan2(camDir.x, camDir.z).toFixed(3));

  const posChanged = (
    lastEmittedX === null ||
    Math.abs(posX - lastEmittedX) > 0.005 ||
    Math.abs(feetY - lastEmittedY) > 0.005 ||
    Math.abs(posZ - lastEmittedZ) > 0.005
  );

  const rotChanged = (
    lastEmittedYaw === null ||
    Math.abs(yaw - lastEmittedYaw) > 0.005
  );

  // Send when moved, turned, forced, or heartbeat timeout (~80ms)
  if (force || posChanged || rotChanged || (now - lastEmitTime > 80)) {
    lastEmittedX = posX;
    lastEmittedY = feetY;
    lastEmittedZ = posZ;
    lastEmittedYaw = yaw;
    lastEmitTime = now;

    socket.emit('playerMove', {
      position: { x: posX, y: feetY, z: posZ },
      rotation: yaw,
    });
  }
}

// Immediate look-around sync on mouse move while locked
window.addEventListener('mousemove', () => {
  if (controls && controls.isLocked) {
    emitLocalTransform();
  }
});

// --- Low-Poly 3D Assault Rifle Attached to Player View ---
const gunGroup = new THREE.Group();

const gunMetal = new THREE.MeshStandardMaterial({
  color: 0x22262c,
  roughness: 0.35,
  metalness: 0.85,
});

const gunPolymer = new THREE.MeshStandardMaterial({
  color: 0x121417,
  roughness: 0.7,
  metalness: 0.2,
});

const gunAccent = new THREE.MeshStandardMaterial({
  color: 0x3d444d,
  roughness: 0.45,
  metalness: 0.6,
});

const gunDetail = new THREE.MeshStandardMaterial({
  color: 0x6e7681,
  roughness: 0.3,
  metalness: 0.9,
});

// Upper and lower receiver
const upperReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.055, 0.32), gunMetal);
upperReceiver.position.set(0, 0.02, -0.05);
gunGroup.add(upperReceiver);

const lowerReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.045, 0.22), gunPolymer);
lowerReceiver.position.set(0, -0.025, 0.0);
gunGroup.add(lowerReceiver);

// Ejection port
const ejectionPort = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.02, 0.06), gunDetail);
ejectionPort.position.set(0.024, 0.025, -0.02);
gunGroup.add(ejectionPort);

// Handguard, barrel, and muzzle brake
const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.052, 0.22), gunPolymer);
handguard.position.set(0, 0.02, -0.30);
gunGroup.add(handguard);

const barrelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.24, 8);
barrelGeo.rotateX(Math.PI / 2);
const barrel = new THREE.Mesh(barrelGeo, gunMetal);
barrel.position.set(0, 0.025, -0.52);
gunGroup.add(barrel);

const muzzleGeo = new THREE.CylinderGeometry(0.018, 0.014, 0.06, 8);
muzzleGeo.rotateX(Math.PI / 2);
const muzzleBrake = new THREE.Mesh(muzzleGeo, gunAccent);
muzzleBrake.position.set(0, 0.025, -0.66);
gunGroup.add(muzzleBrake);

// Picatinny top rail and iron sights
const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.014, 0.36), gunAccent);
topRail.position.set(0, 0.054, -0.10);
gunGroup.add(topRail);

const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.024, 0.016), gunPolymer);
rearSight.position.set(0, 0.068, 0.06);
gunGroup.add(rearSight);

const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.012), gunPolymer);
frontSight.position.set(0, 0.065, -0.40);
gunGroup.add(frontSight);

// Pistol grip
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.12, 0.055), gunPolymer);
grip.position.set(0, -0.08, 0.08);
grip.rotation.x = Math.PI * 0.12;
gunGroup.add(grip);

// Curved magazine
const mag = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.16, 0.075), gunPolymer);
mag.position.set(0, -0.11, -0.12);
mag.rotation.x = -Math.PI * 0.08;
gunGroup.add(mag);

// Tactical stock & buffer tube
const bufferTubeGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.14, 8);
bufferTubeGeo.rotateX(Math.PI / 2);
const bufferTube = new THREE.Mesh(bufferTubeGeo, gunAccent);
bufferTube.position.set(0, 0.015, 0.18);
gunGroup.add(bufferTube);

const stockBody = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.09, 0.15), gunPolymer);
stockBody.position.set(0, -0.015, 0.28);
gunGroup.add(stockBody);

const buttPad = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.105, 0.02), gunMetal);
buttPad.position.set(0, -0.015, 0.36);
gunGroup.add(buttPad);

// Muzzle Flash & Light
const muzzlePos = new THREE.Vector3(0, 0.025, -0.72);
const muzzleLight = new THREE.PointLight(0xffaa22, 0, 10, 2);
muzzleLight.position.copy(muzzlePos);
gunGroup.add(muzzleLight);

const flashGeo = new THREE.PlaneGeometry(0.2, 0.2);
const flashMat = new THREE.MeshBasicMaterial({
  color: 0xffea75,
  transparent: true,
  opacity: 0.95,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const flash1 = new THREE.Mesh(flashGeo, flashMat);
const flash2 = new THREE.Mesh(flashGeo, flashMat);
flash2.rotation.z = Math.PI / 2;
const flash3 = new THREE.Mesh(flashGeo, flashMat);
flash3.rotation.y = Math.PI / 2;

const muzzleFlashGroup = new THREE.Group();
muzzleFlashGroup.add(flash1, flash2, flash3);
muzzleFlashGroup.position.copy(muzzlePos);
muzzleFlashGroup.visible = false;
gunGroup.add(muzzleFlashGroup);

// Position weapon in bottom-right of camera view
const gunRestPos = new THREE.Vector3(0.24, -0.21, -0.46);
const gunRestRot = new THREE.Euler(0, -0.04, 0);
gunGroup.position.copy(gunRestPos);
gunGroup.rotation.copy(gunRestRot);

// Attach gun to camera and camera to scene
camera.add(gunGroup);
scene.add(camera);

// --- Shooting, Recoil & Bullet Holes ---
let recoilKick = 0;
let recoilPitch = 0;
let recoilYaw = 0;
let muzzleFlashTimer = 0;
let lastShootTime = 0;
const shootCooldown = 120; // 120ms between shots

const raycaster = new THREE.Raycaster();
const centerCoords = new THREE.Vector2(0, 0);

// Procedural Bullet Hole Texture
const holeCanvas = document.createElement('canvas');
holeCanvas.width = 128;
holeCanvas.height = 128;
const hCtx = holeCanvas.getContext('2d');
const radGrad = hCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
radGrad.addColorStop(0, 'rgba(10, 10, 12, 0.98)');
radGrad.addColorStop(0.25, 'rgba(25, 25, 30, 0.9)');
radGrad.addColorStop(0.65, 'rgba(60, 60, 68, 0.35)');
radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
hCtx.fillStyle = radGrad;
hCtx.fillRect(0, 0, 128, 128);

for (let i = 0; i < 24; i++) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 6 + Math.random() * 42;
  hCtx.fillStyle = 'rgba(20, 22, 26, 0.55)';
  hCtx.beginPath();
  hCtx.arc(64 + Math.cos(angle) * dist, 64 + Math.sin(angle) * dist, 2 + Math.random() * 3, 0, Math.PI * 2);
  hCtx.fill();
}

const bulletHoleTexture = new THREE.CanvasTexture(holeCanvas);
const bulletHoleGeo = new THREE.PlaneGeometry(0.18, 0.18);
const bulletHoles = [];
const MAX_BULLET_HOLES = 80;

// Impact Sparks
const sparkParticles = [];
const sparkMat = new THREE.PointsMaterial({
  color: 0xffcc44,
  size: 0.06,
  transparent: true,
  opacity: 1.0,
  blending: THREE.AdditiveBlending,
});

function spawnImpactSparks(point, normal) {
  const count = 8;
  const positions = [];
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions.push(point.x, point.y, point.z);
    const spread = new THREE.Vector3(
      (Math.random() - 0.5) * 1.6,
      (Math.random() - 0.5) * 1.6,
      (Math.random() - 0.5) * 1.6
    );
    const vel = normal.clone().multiplyScalar(2.0 + Math.random() * 2.5).add(spread);
    velocities.push(vel);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const pSystem = new THREE.Points(pGeo, sparkMat.clone());
  scene.add(pSystem);
  sparkParticles.push({
    system: pSystem,
    velocities,
    life: 0.2,
    maxLife: 0.2,
  });
}

function spawnDeathParticles(center) {
  const count = 28;
  const positions = [];
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions.push(center.x, center.y, center.z);
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 6,
      Math.random() * 5 + 1.5,
      (Math.random() - 0.5) * 6
    );
    velocities.push(vel);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xef4444,
    size: 0.12,
    transparent: true,
    opacity: 1.0,
  });
  const pSystem = new THREE.Points(pGeo, pMat);
  scene.add(pSystem);
  sparkParticles.push({
    system: pSystem,
    velocities,
    life: 0.45,
    maxLife: 0.45,
  });
}

function spawnHitSparks(point, isHeadshot = false) {
  const count = isHeadshot ? 20 : 12;
  const positions = [];
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions.push(point.x, point.y, point.z);
    const speed = isHeadshot ? 4.5 : 3.0;
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * speed,
      Math.random() * speed + 1,
      (Math.random() - 0.5) * speed
    );
    velocities.push(vel);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: isHeadshot ? 0xfacc15 : 0xff3b30,
    size: isHeadshot ? 0.10 : 0.08,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
  });
  const pSystem = new THREE.Points(pGeo, pMat);
  scene.add(pSystem);
  sparkParticles.push({
    system: pSystem,
    velocities,
    life: isHeadshot ? 0.35 : 0.25,
    maxLife: isHeadshot ? 0.35 : 0.25,
  });
}

// --- Procedural Web Audio API Sound Effects (Zero External Files) ---
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Procedural Gunshot: punchy transient crack + low body kick
function playGunshotSound() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // 1. Noise burst for supersonic bullet crack
  const bufferSize = Math.floor(ctx.sampleRate * 0.11);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
  }
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(1400, now);
  bandpass.Q.setValueAtTime(1.4, now);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.75, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

  noiseSource.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  // 2. Low-frequency punch / thud
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + 0.14);

  oscGain.gain.setValueAtTime(0.85, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);

  noiseSource.start(now);
  osc.start(now);
  osc.stop(now + 0.14);
}

// Procedural Reload: Mag drop -> Mag insert -> Bolt slide & chamber snap (Fast 1.0s duration)
function playReloadSound() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  function triggerClick(time, freq, duration, gainVal) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, time + duration);

    gain.gain.setValueAtTime(gainVal, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }

  function triggerRasp(time, filterFreq, duration) {
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, time);
    filter.Q.setValueAtTime(3.2, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(time);
  }

  // 1. Mag release / drop (0.04s)
  triggerClick(now + 0.04, 820, 0.05, 0.4);
  triggerRasp(now + 0.06, 1800, 0.09);

  // 2. Mag insert / latch (0.45s)
  triggerClick(now + 0.45, 460, 0.07, 0.45);
  triggerClick(now + 0.52, 920, 0.05, 0.5);

  // 3. Bolt pull & chamber snap (0.80s)
  triggerRasp(now + 0.76, 2200, 0.08);
  triggerClick(now + 0.82, 1300, 0.05, 0.55);
  triggerClick(now + 0.88, 620, 0.07, 0.4);
}

// Procedural Hit-marker: High-frequency metallic tick/ding + Headshot harmonic ping
function playHitmarkerSound(isKill = false, isHeadshot = false) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = isHeadshot ? 'sine' : 'triangle';
  const freq = isHeadshot ? 2600 : (isKill ? 2200 : 1550);
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.75, now + 0.08);

  gain.gain.setValueAtTime(isHeadshot ? 0.75 : (isKill ? 0.65 : 0.45), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (isHeadshot ? 0.12 : 0.06));

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + (isHeadshot ? 0.12 : 0.06));

  if (isHeadshot) {
    // Harmonic bell ding for headshot
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(3400, now);
    osc2.frequency.exponentialRampToValueAtTime(1700, now + 0.14);
    gain2.gain.setValueAtTime(0.5, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + 0.14);
  }
}

// Dry Empty Click
function playEmptyClick() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(950, now);
  osc.frequency.exponentialRampToValueAtTime(250, now + 0.04);

  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

// --- Deadshot.io Style HUD State & Controls ---
const healthValueEl = document.getElementById('health-value');
const healthBarFillEl = document.getElementById('health-bar-fill');
const ammoCurrentEl = document.getElementById('ammo-current');
const ammoMaxEl = document.getElementById('ammo-max');
const reloadBadgeEl = document.getElementById('reload-badge');
const killsValueEl = document.getElementById('kills-value');
const hitmarkerEl = document.getElementById('hitmarker');
const headshotBannerEl = document.getElementById('headshot-banner');

let playerHealth = 100;
const playerMaxHealth = 100;
let ammo = 30;
const maxAmmo = 30;
let isReloading = false;
let reloadTimer = 0;
const reloadDuration = 1.0; // Reduced to 1.0-second fast reload
let kills = 0;
let hitmarkerTimeout = null;
let headshotTimeout = null;

function updateHealthHUD() {
  if (healthValueEl) healthValueEl.textContent = playerHealth;
  if (healthBarFillEl) {
    const ratio = Math.max(0, playerHealth / playerMaxHealth) * 100;
    healthBarFillEl.style.width = `${ratio}%`;
  }
}

function updateAmmoHUD() {
  if (isReloading) {
    if (ammoCurrentEl) ammoCurrentEl.textContent = '...';
    if (reloadBadgeEl) {
      reloadBadgeEl.textContent = 'RELOADING...';
      reloadBadgeEl.className = 'hud-badge reloading';
    }
  } else {
    if (ammoCurrentEl) ammoCurrentEl.textContent = ammo;
    if (reloadBadgeEl) {
      if (ammo === 0) {
        reloadBadgeEl.textContent = '[R] RELOAD!';
        reloadBadgeEl.className = 'hud-badge empty';
      } else if (ammo <= 8) {
        reloadBadgeEl.textContent = '[R] LOW AMMO';
        reloadBadgeEl.className = 'hud-badge empty';
      } else {
        reloadBadgeEl.textContent = '[R] RELOAD';
        reloadBadgeEl.className = 'hud-badge';
      }
    }
  }
}

function startReload() {
  if (isReloading || ammo === maxAmmo) return;
  isReloading = true;
  reloadTimer = reloadDuration;
  playReloadSound();
  updateAmmoHUD();
}

function addKill() {
  kills++;
  if (killsValueEl) {
    killsValueEl.textContent = kills;
  }
}

function showHitmarker(isKill = false, isHeadshot = false) {
  if (!hitmarkerEl) return;
  hitmarkerEl.classList.remove('kill', 'headshot');

  if (isHeadshot) {
    hitmarkerEl.classList.add('headshot');
    if (headshotBannerEl) {
      headshotBannerEl.classList.remove('active');
      void headshotBannerEl.offsetWidth; // Force CSS reflow to re-trigger pop animation
      headshotBannerEl.classList.add('active');
      if (headshotTimeout) clearTimeout(headshotTimeout);
      headshotTimeout = setTimeout(() => {
        headshotBannerEl.classList.remove('active');
      }, 700);
    }
  } else if (isKill) {
    hitmarkerEl.classList.add('kill');
  }
  hitmarkerEl.classList.add('active');

  if (hitmarkerTimeout) clearTimeout(hitmarkerTimeout);
  hitmarkerTimeout = setTimeout(() => {
    hitmarkerEl.classList.remove('active');
  }, 120);
}

function shoot() {
  const now = performance.now();
  if (now - lastShootTime < shootCooldown) return;

  if (isReloading) return;

  if (ammo <= 0) {
    playEmptyClick();
    startReload();
    return;
  }

  lastShootTime = now;
  ammo--;
  updateAmmoHUD();

  // Play procedural gunshot audio
  playGunshotSound();

  // Recoil impulse
  recoilKick = 0.055;
  recoilPitch = 0.10;
  recoilYaw = (Math.random() - 0.5) * 0.02;

  // Muzzle flash light & visual geometry
  muzzleLight.intensity = 5.0;
  muzzleFlashGroup.visible = true;
  muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
  muzzleFlashGroup.scale.setScalar(0.85 + Math.random() * 0.4);
  muzzleFlashTimer = 0.05;

  // Raycast from screen center crosshair (0, 0)
  raycaster.setFromCamera(centerCoords, camera);
  const intersects = raycaster.intersectObjects(shootables, false);

  if (intersects.length > 0) {
    const hit = intersects[0];
    const hitPlayer = hit.object.userData.player;

    if (hitPlayer && hitPlayer.isAlive) {
      // Body-Part Damage: Head (60), Body/Arms (40), Legs (30)
      const part = hit.object.userData.part || 'body';
      let damage = 40;
      const isHeadshot = (part === 'head');

      if (isHeadshot) {
        damage = 60; // Headshot
      } else if (part === 'legs') {
        damage = 30; // Legs
      } else {
        damage = 40; // Body / Arms
      }

      const willDie = hitPlayer.hp <= damage;
      hitPlayer.flashHit();
      spawnHitSparks(hit.point, isHeadshot);
      showHitmarker(willDie, isHeadshot);
      playHitmarkerSound(willDie, isHeadshot);

      // Send playerHit event to server
      if (socket && socket.connected) {
        socket.emit('playerHit', {
          targetId: hitPlayer.id,
          part: part,
          damage: damage,
          shooterId: socket.id,
        });
      }
    } else if (!hitPlayer) {
      // Hit wall, cover box, or floor: place bullet hole decal
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();

      const holeMat = new THREE.MeshBasicMaterial({
        map: bulletHoleTexture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const holeMesh = new THREE.Mesh(bulletHoleGeo, holeMat);
      holeMesh.position.copy(hit.point).addScaledVector(worldNormal, 0.003);
      holeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
      holeMesh.rotateZ(Math.random() * Math.PI * 2);
      scene.add(holeMesh);

      bulletHoles.push({
        mesh: holeMesh,
        createdAt: now,
        maxAge: 8000,
      });

      if (bulletHoles.length > MAX_BULLET_HOLES) {
        const old = bulletHoles.shift();
        scene.remove(old.mesh);
        old.mesh.material.dispose();
      }

      spawnImpactSparks(hit.point, worldNormal);
    }
  }
}

// --- First Person Controls & Interaction ---
const controls = new PointerLockControls(camera, document.body);
const instructionsOverlay = document.getElementById('instructions');
const playButton = document.getElementById('play-button');
const playBtnText = document.getElementById('play-btn-text');
const nicknameInput = document.getElementById('nickname-input');
const hudPlayerName = document.getElementById('hud-player-name');

let isMouseDown = false;

// Handle Player Nickname Persistence & HUD Update
const savedNickname = localStorage.getItem('fps_nickname') || 'Player_1';
if (nicknameInput) {
  nicknameInput.value = savedNickname;
  if (hudPlayerName) hudPlayerName.textContent = savedNickname;

  nicknameInput.addEventListener('input', () => {
    const name = nicknameInput.value.trim() || 'Player_1';
    if (hudPlayerName) hudPlayerName.textContent = name;
    localStorage.setItem('fps_nickname', name);
  });

  // Start game immediately if Enter is pressed in nickname input
  nicknameInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      lockControls();
    }
  });

  // Prevent typing or clicking in nickname box from accidentally locking controls
  nicknameInput.addEventListener('click', (e) => e.stopPropagation());
  nicknameInput.addEventListener('mousedown', (e) => e.stopPropagation());
}

// Click to Play function
function lockControls() {
  getAudioContext();
  const currentNick = (nicknameInput ? nicknameInput.value.trim() : '') || 'Player_1';
  initMultiplayer(currentNick);

  if (!controls.isLocked) {
    controls.lock();
  }
}

if (playButton) {
  playButton.addEventListener('click', (e) => {
    e.stopPropagation();
    lockControls();
  });
}

instructionsOverlay.addEventListener('click', (e) => {
  // If clicked on the overlay background or outside input, lock controls
  if (e.target !== nicknameInput && !nicknameInput.contains(e.target)) {
    lockControls();
  }
});

controls.addEventListener('lock', () => {
  instructionsOverlay.classList.add('hidden');
  setTimeout(() => emitLocalTransform(true), 50);
});

controls.addEventListener('unlock', () => {
  isMouseDown = false;
  instructionsOverlay.classList.remove('hidden');
  if (playBtnText) {
    playBtnText.textContent = 'RESUME GAME';
  }
  // Reset movement keys so player doesn't keep sliding
  moveState.forward = false;
  moveState.backward = false;
  moveState.left = false;
  moveState.right = false;
});

// Left-click shoot and continuous holding handler (unblocked by WASD/jump)
window.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    if (controls.isLocked) {
      isMouseDown = true;
      shoot();
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    isMouseDown = false;
  }
});

window.addEventListener('blur', () => {
  isMouseDown = false;
});

// Keyboard State
const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

window.addEventListener('keydown', (e) => {
  if (!controls.isLocked) return;

  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      moveState.forward = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      moveState.backward = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      moveState.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      moveState.right = true;
      break;
    case 'KeyR':
      if (ammo < maxAmmo && !isReloading) {
        startReload();
      }
      break;
    case 'Space':
      e.preventDefault();
      if (canJump) {
        velocity.y = 9.5; // Jump impulse
        canJump = false;
      }
      break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      moveState.forward = false;
      break;
    case 'KeyS':
    case 'ArrowDown':
      moveState.backward = false;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      moveState.left = false;
      break;
    case 'KeyD':
    case 'ArrowRight':
      moveState.right = false;
      break;
  }
});

// Physics & Movement Variables
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let canJump = false;
const playerRadius = 0.45;
const playerHeight = 1.8;
const gravity = 26.0; // Realistic snappy gravity
let prevTime = performance.now();

// --- Bounding-Box Collision Detection & Ground Height ---
function getGroundHeight(x, z, currentY) {
  let groundY = 0; // Default arena floor at y = 0

  for (let i = 0; i < colliders.length; i++) {
    const col = colliders[i];
    // Check horizontal footprint overlap
    if (
      x + playerRadius > col.min.x &&
      x - playerRadius < col.max.x &&
      z + playerRadius > col.min.z &&
      z - playerRadius < col.max.z
    ) {
      // Check if player feet are near or above top surface of this collider
      const playerFeet = currentY - playerHeight;
      if (playerFeet >= col.max.y - 0.25) {
        if (col.max.y > groundY) {
          groundY = col.max.y;
        }
      }
    }
  }
  return groundY;
}

function checkCollision(pos) {
  const pMinX = pos.x - playerRadius;
  const pMaxX = pos.x + playerRadius;
  const pMinY = pos.y - playerHeight;
  const pMaxY = pos.y + 0.1;
  const pMinZ = pos.z - playerRadius;
  const pMaxZ = pos.z + playerRadius;

  for (let i = 0; i < colliders.length; i++) {
    const col = colliders[i];
    // Ignore if player is standing completely above or below the obstacle
    const isVerticallyOverlapping = pMaxY > col.min.y + 0.05 && pMinY < col.max.y - 0.05;
    if (!isVerticallyOverlapping) continue;

    // Check horizontal AABB overlap
    if (pMaxX > col.min.x && pMinX < col.max.x && pMaxZ > col.min.z && pMinZ < col.max.z) {
      return col;
    }
  }
  return null;
}

// Axis-separated movement with wall sliding resolution
function moveAxis(axis, deltaDist) {
  if (Math.abs(deltaDist) < 0.00001) return;

  camera.position[axis] += deltaDist;
  const col = checkCollision(camera.position);

  if (col) {
    if (deltaDist > 0) {
      camera.position[axis] = col.min[axis] - playerRadius - 0.001;
    } else {
      camera.position[axis] = col.max[axis] + playerRadius + 0.001;
    }

    // Safety fallback: revert delta if edge resolution still conflicts
    if (checkCollision(camera.position)) {
      camera.position[axis] -= deltaDist;
    }
  }
}

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);

  const time = performance.now();
  const delta = Math.min((time - prevTime) / 1000, 0.1);
  prevTime = time;

  // Reload Timer & Mechanical Dip Motion
  let reloadOffsetY = 0;
  let reloadPitch = 0;
  if (isReloading) {
    reloadTimer -= delta;
    const progress = 1 - Math.max(0, reloadTimer / reloadDuration);
    reloadOffsetY = Math.sin(progress * Math.PI) * -0.07;
    reloadPitch = Math.sin(progress * Math.PI) * -0.22;

    if (reloadTimer <= 0) {
      ammo = maxAmmo;
      isReloading = false;
      updateAmmoHUD();
    }
  }

  // Gun Recoil Recovery & Reload Motion
  recoilKick = THREE.MathUtils.lerp(recoilKick, 0, delta * 24);
  recoilPitch = THREE.MathUtils.lerp(recoilPitch, 0, delta * 28);
  recoilYaw = THREE.MathUtils.lerp(recoilYaw, 0, delta * 28);
  gunGroup.position.set(gunRestPos.x, gunRestPos.y + reloadOffsetY, gunRestPos.z + recoilKick);
  gunGroup.rotation.set(gunRestRot.x - recoilPitch + reloadPitch, gunRestRot.y + recoilYaw, gunRestRot.z);

  // Muzzle flash turn-off timer
  if (muzzleFlashTimer > 0) {
    muzzleFlashTimer -= delta;
    if (muzzleFlashTimer <= 0) {
      muzzleLight.intensity = 0;
      muzzleFlashGroup.visible = false;
    }
  }

  // Bullet holes fade out and cleanup
  const now = performance.now();
  for (let i = bulletHoles.length - 1; i >= 0; i--) {
    const item = bulletHoles[i];
    const age = now - item.createdAt;
    if (age > item.maxAge) {
      scene.remove(item.mesh);
      item.mesh.material.dispose();
      bulletHoles.splice(i, 1);
    } else if (age > item.maxAge - 2000) {
      item.mesh.material.opacity = Math.max(0, (item.maxAge - age) / 2000) * 0.95;
    }
  }

  // Spark particles update
  for (let i = sparkParticles.length - 1; i >= 0; i--) {
    const sp = sparkParticles[i];
    sp.life -= delta;
    if (sp.life <= 0) {
      scene.remove(sp.system);
      sp.system.geometry.dispose();
      sp.system.material.dispose();
      sparkParticles.splice(i, 1);
    } else {
      const positions = sp.system.geometry.attributes.position.array;
      for (let j = 0; j < sp.velocities.length; j++) {
        const v = sp.velocities[j];
        positions[j * 3] += v.x * delta;
        positions[j * 3 + 1] += v.y * delta;
        positions[j * 3 + 2] += v.z * delta;
        v.y -= 9.8 * delta; // Particle gravity
      }
      sp.system.geometry.attributes.position.needsUpdate = true;
      sp.system.material.opacity = Math.max(0, sp.life / sp.maxLife);
    }
  }

  // Update remote soldiers (health bar & name tag billboarding, lerp movement, leg-swing walk animation)
  remotePlayers.forEach((soldier) => {
    soldier.update(delta);
  });

  // Sync local player position & look-around rotation to server
  emitLocalTransform();

  if (controls.isLocked) {
    // Smooth continuous shooting while holding left-click (unblocked during movement & jumps)
    if (isMouseDown) {
      shoot();
    }

    // Damping / Friction for smooth deceleration
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    // Apply realistic gravity
    velocity.y -= gravity * delta;

    direction.z = Number(moveState.forward) - Number(moveState.backward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();

    const speed = 55.0;
    if (moveState.forward || moveState.backward) velocity.z -= direction.z * speed * delta;
    if (moveState.left || moveState.right) velocity.x -= direction.x * speed * delta;

    // Compute camera horizontal forward and right vectors
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();

    // Desired horizontal displacements in world space
    const moveX = -velocity.z * delta * forward.x + -velocity.x * delta * right.x;
    const moveZ = -velocity.z * delta * forward.z + -velocity.x * delta * right.z;

    // Move along X and slide smoothly along any wall/box
    moveAxis('x', moveX);

    // Move along Z and slide smoothly along any wall/box
    moveAxis('z', moveZ);

    // Vertical movement & ground collision (floor and tops of cover boxes)
    camera.position.y += velocity.y * delta;
    const groundY = getGroundHeight(camera.position.x, camera.position.z, camera.position.y);
    const minCameraY = groundY + playerHeight;

    if (camera.position.y <= minCameraY) {
      camera.position.y = minCameraY;
      velocity.y = 0;
      canJump = true;
    }

    // Outer arena boundary safety clamp
    const halfArena = floorSize / 2 - wallThickness / 2 - playerRadius;
    camera.position.x = Math.max(-halfArena, Math.min(halfArena, camera.position.x));
    camera.position.z = Math.max(-halfArena, Math.min(halfArena, camera.position.z));
  }

  renderer.render(scene, camera);
}

animate();

// Initial HUD Setup
updateHealthHUD();
updateAmmoHUD();
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
