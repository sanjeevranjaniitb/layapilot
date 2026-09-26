import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { heading } from "./math.js";

// ─── Materials ────────────────────────────────────────────────────────────────
const roadMat = () => new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 0.92, metalness: 0 });
const lineMat = () => new THREE.MeshStandardMaterial({ color: "#e8e8d0", roughness: 0.8, metalness: 0 });
const grassMat = () => new THREE.MeshStandardMaterial({ color: "#3d5c2a", roughness: 1, metalness: 0 });
const buildingMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });

// ─── Road builder ─────────────────────────────────────────────────────────────
function buildStrip(pts, offset, width, mat, y, scene) {
  const positions = [], indices = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    for (const s of [-1, 1])
      positions.push(pts[i].x - (dz / len) * (offset + s * width / 2), y, pts[i].z + (dx / len) * (offset + s * width / 2));
    if (i < pts.length - 1) { const k = i * 2; indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildDashedLine(pts, offset, scene) {
  const mat = lineMat();
  for (let i = 0; i < pts.length - 1; i += 4) {
    const p = pts[i], q = pts[Math.min(i + 2, pts.length - 1)];
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const cx = (p.x + q.x) / 2 + nx * offset, cz = (p.z + q.z) / 2 + nz * offset;
    const angle = Math.atan2(dx, -dz);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.18, Math.min(len, 4)), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -angle;
    mesh.position.set(cx, 0.022, cz);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function buildWorld(scene, world) {
  const bounds = world.bounds || { minX: -370, maxX: 370, minZ: -805, maxZ: 740 };
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const gw = bounds.maxX - bounds.minX + 600, gh = bounds.maxZ - bounds.minZ + 600;

  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), grassMat());
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.01, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  if (world.type === "highway") {
    const pts = world.roadSamples;
    buildStrip(pts, 0, 32, roadMat(), 0.01, scene);          // full carriageway
    buildStrip(pts, 0, 25, roadMat(), 0.015, scene);          // driving lanes
    buildStrip(pts, -11.5, 0.22, lineMat(), 0.025, scene);    // left edge
    buildStrip(pts, 11.5, 0.22, lineMat(), 0.025, scene);     // right edge
    buildStrip(pts, 0, 0.18, lineMat(), 0.025, scene);        // center solid
    buildDashedLine(pts, -7, scene);                           // left lane dash
    buildDashedLine(pts, 7, scene);                            // right lane dash
  }

  // Town / connector roads
  for (const road of world.connectorRoads || []) {
    const rpts = road.points;
    buildStrip(rpts, 0, road.width + 1, roadMat(), 0.012, scene);
    buildStrip(rpts, -(road.width / 2), 0.15, lineMat(), 0.022, scene);
    buildStrip(rpts, road.width / 2, 0.15, lineMat(), 0.022, scene);
    if (road.twoWay) buildDashedLine(rpts, 0, scene);
  }

  // Buildings
  for (const obj of world.objects.filter(o => o.type === "building")) {
    const color = obj.color || "#d4c9b0";
    const group = new THREE.Group();
    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(obj.width, obj.height, obj.depth), buildingMat(color));
    body.position.y = obj.height / 2;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    // Roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(obj.width + 0.3, 0.3, obj.depth + 0.3), buildingMat("#888"));
    roof.position.y = obj.height + 0.15;
    roof.castShadow = true;
    group.add(roof);
    // Windows
    const winMat = new THREE.MeshStandardMaterial({ color: "#aaccee", emissive: "#334455", emissiveIntensity: 0.4, roughness: 0.1 });
    const floors = Math.max(1, Math.floor(obj.height / 3));
    for (let f = 0; f < floors; f++) {
      for (let w = 0; w < 3; w++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), winMat);
        win.position.set(-obj.width / 2 + 0.01, 1.2 + f * 3, -obj.depth / 4 + w * (obj.depth / 3));
        win.rotation.y = Math.PI / 2;
        group.add(win);
      }
    }
    group.position.set(obj.x, 0, obj.z);
    group.rotation.y = -(obj.rotation || 0);
    scene.add(group);
  }

  // Trees
  for (const obj of world.objects.filter(o => o.type === "tree")) {
    const h = obj.height;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.25, h * 0.45, 8),
      new THREE.MeshStandardMaterial({ color: "#6b4c2a", roughness: 0.95 })
    );
    trunk.position.set(obj.x, h * 0.225, obj.z);
    trunk.castShadow = true;
    scene.add(trunk);

    if (obj.kind === "pine") {
      for (let tier = 0; tier < 3; tier++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(h * (0.28 - tier * 0.06), h * 0.32, 8),
          new THREE.MeshStandardMaterial({ color: "#2d4a1e", roughness: 1 })
        );
        cone.position.set(obj.x, h * (0.45 + tier * 0.22), obj.z);
        cone.castShadow = true;
        scene.add(cone);
      }
    } else {
      const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(h * 0.33, 8, 6),
        new THREE.MeshStandardMaterial({ color: "#3a6b22", roughness: 1 })
      );
      canopy.position.set(obj.x, h * 0.75, obj.z);
      canopy.castShadow = true;
      scene.add(canopy);
    }
  }

  // Street lights
  for (const obj of world.objects.filter(o => o.type === "streetlight")) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, obj.height || 6, 6),
      new THREE.MeshStandardMaterial({ color: "#888", metalness: 0.8, roughness: 0.3 })
    );
    pole.position.set(obj.x, (obj.height || 6) / 2, obj.z);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshStandardMaterial({ color: "#fffde0", emissive: "#fffaaa", emissiveIntensity: 2 })
    );
    lamp.position.set(obj.x, obj.height || 6, obj.z);
    scene.add(lamp);
    const light = new THREE.PointLight("#fffaaa", 0.8, 30);
    light.position.set(obj.x, obj.height || 6, obj.z);
    scene.add(light);
  }
}

// ─── Car loader ───────────────────────────────────────────────────────────────
async function loadCarModel(color = "#cc2200") {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load("/models/car.glb", (gltf) => {
      const model = gltf.scene;
      // Apply paint color
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = child.receiveShadow = true;
        const name = child.material?.name?.toLowerCase() || "";
        if (name.includes("body") || name.includes("paint") || name.includes("car")) {
          child.material = new THREE.MeshPhysicalMaterial({
            color, metalness: 0.6, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1
          });
        }
      });
      // Normalize scale to ~4.5m length
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = 4.5 / Math.max(size.x, size.z);
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      // Sit on ground
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y = -box2.min.y;
      resolve(model);
    }, undefined, () => {
      // Fallback: clean procedural car if GLB fails
      resolve(buildFallbackCar(color));
    });
  });
}

function buildFallbackCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.2, clearcoat: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#1a2530", roughness: 0.05, transparent: true, opacity: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.9 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: "#bbb", metalness: 0.95, roughness: 0.15 });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    m.castShadow = m.receiveShadow = true; g.add(m);
  };

  // Body
  add(new THREE.BoxGeometry(1.88, 0.5, 4.2), paint, 0, 0.55, 0);
  // Cabin
  add(new THREE.BoxGeometry(1.6, 0.52, 1.9), paint, 0, 1.0, -0.1);
  // Windshield
  add(new THREE.PlaneGeometry(1.5, 0.65), glass, 0, 1.02, 0.88, -0.52);
  add(new THREE.PlaneGeometry(1.5, 0.58), glass, 0, 1.0, -1.1, 0.52);
  // Side windows
  [-0.85, 0.85].forEach(x => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.42), glass); m.position.set(x, 1.0, -0.12); m.rotation.y = Math.PI / 2; g.add(m); });
  // Roof
  add(new THREE.BoxGeometry(1.5, 0.08, 1.1), paint, 0, 1.3, -0.1);
  // Hood / trunk slopes
  add(new THREE.BoxGeometry(1.82, 0.12, 1.0), paint, 0, 0.82, 1.45, 0.18);
  add(new THREE.BoxGeometry(1.82, 0.1, 0.85), paint, 0, 0.8, -1.5, -0.12);
  // Bumpers
  add(new THREE.BoxGeometry(1.9, 0.28, 0.15), dark, 0, 0.35, 2.15);
  add(new THREE.BoxGeometry(1.9, 0.28, 0.15), dark, 0, 0.35, -2.15);
  // Headlights
  const hl = new THREE.MeshStandardMaterial({ color: "#f8fcff", emissive: "#cce8ff", emissiveIntensity: 3 });
  [-0.62, 0.62].forEach(x => add(new THREE.BoxGeometry(0.55, 0.12, 0.06), hl, x, 0.58, 2.12));
  const tl = new THREE.MeshStandardMaterial({ color: "#ff1111", emissive: "#cc0000", emissiveIntensity: 2 });
  [-0.62, 0.62].forEach(x => add(new THREE.BoxGeometry(0.55, 0.12, 0.06), tl, x, 0.58, -2.12));
  // Wheels
  const rubber = new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.95 });
  [[-1.28, -0.88], [-1.28, 0.88], [1.28, -0.88], [1.28, 0.88]].forEach(([wz, wx]) => {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 12, 28), rubber);
    tire.rotation.y = Math.PI / 2; tire.position.set(wx, 0.3, wz);
    tire.castShadow = true; g.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10), chrome);
    rim.rotation.z = Math.PI / 2; rim.position.set(wx, 0.3, wz);
    g.add(rim);
  });
  return g;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
export class SceneRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.FogExp2(0xc8dff0, 0.004);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 800);

    // Environment cubemap for reflections
    const cubeLoader = new THREE.CubeTextureLoader();
    cubeLoader.setPath("/env/");
    const envMap = cubeLoader.load(["posx.jpg","negx.jpg","posy.jpg","negy.jpg","posz.jpg","negz.jpg"]);
    this.scene.environment = envMap;

    // Hemisphere
    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x334422, 0.9));

    // Sun
    this.sun = new THREE.DirectionalLight(0xfff8e8, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 250;
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 70;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    // Ambient fill
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.4));

    this.playerMesh = null;
    this.trafficMeshes = new Map();
    this.carTemplate = null;
    this.mode = "follow";
    this.snap = true;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(canvas.parentElement || document.body);
    this._resize();
  }

  async init(sim) {
    this.sim = sim;
    buildWorld(this.scene, sim.world);

    // Load player car (white)
    this.playerMesh = await loadCarModel("#e8eaec");
    this.scene.add(this.playerMesh);

    // Traffic cars — load one template then clone
    this.carTemplate = await loadCarModel("#cc2200");
    for (const v of sim.traffic) {
      const m = this.carTemplate.clone(true);
      // Recolor each traffic car
      m.traverse(child => {
        if (child.isMesh && child.material?.color) {
          const mat = child.material.clone();
          mat.color.set(v.color);
          child.material = mat;
        }
      });
      this.trafficMeshes.set(v.id, m);
      this.scene.add(m);
    }

    // Snap camera to player start
    const p = sim.player;
    this.camPos.set(p.x - Math.sin(p.heading) * 14, 6, p.z + Math.cos(p.heading) * 14);
    this.camera.position.copy(this.camPos);
    this.snap = false;
  }

  _resize() {
    const el = this.renderer.domElement.parentElement || document.body;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    if (!this.sim || !this.playerMesh) return;
    const v = this.sim.player;

    this.playerMesh.position.set(v.x, 0, v.z);
    this.playerMesh.rotation.y = -v.heading;

    for (const t of this.sim.traffic) {
      const m = this.trafficMeshes.get(t.id);
      if (m) { m.position.set(t.x, 0, t.z); m.rotation.y = -t.heading; }
    }

    // Move sun with player
    this.sun.position.set(v.x - 60, 90, v.z + 40);
    this.sun.target.position.set(v.x, 0, v.z);
    this.sun.target.updateMatrixWorld();

    // Camera
    let targetPos, lookAt;
    if (this.mode === "follow") {
      targetPos = new THREE.Vector3(
        v.x - Math.sin(v.heading) * 13,
        5.5,
        v.z + Math.cos(v.heading) * 13
      );
      lookAt = new THREE.Vector3(
        v.x + Math.sin(v.heading) * 15,
        0.8,
        v.z - Math.cos(v.heading) * 15
      );
    } else {
      targetPos = new THREE.Vector3(
        v.x + Math.sin(v.heading) * 0.5,
        1.3,
        v.z - Math.cos(v.heading) * 0.5
      );
      lookAt = new THREE.Vector3(
        v.x + Math.sin(v.heading) * 30,
        1.3,
        v.z - Math.cos(v.heading) * 30
      );
    }

    const a = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(targetPos, a);
    this.camLook.lerp(lookAt, a);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
