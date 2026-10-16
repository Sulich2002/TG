import * as THREE from './vendor/three.module.js';
import {bodyShape} from './avatar-shape.js?v=0.4.0';
export async function createAvatar(container,initialLevel=1,initialProfile={sex:'male',height:175,weight:78}) {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Модель человека. Проведи пальцем влево или вправо, чтобы повернуть.');canvas.setAttribute('role','img');container.append(canvas);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(33,1,.1,30);camera.position.set(0,1.82,7);camera.lookAt(0,1.8,0);
  scene.add(new THREE.HemisphereLight(0xe8eeff,0x48413e,2));
  const key=new THREE.DirectionalLight(0xffeddd,2.5);key.position.set(-3,5,4);scene.add(key);
  const fill=new THREE.DirectionalLight(0xb5cfff,1);fill.position.set(3,2,-3);scene.add(fill);
  const character=new THREE.Group();scene.add(character);
  const skin=new THREE.MeshStandardMaterial({color:0xc49a82,roughness:.73});
  const fabric=new THREE.MeshStandardMaterial({color:0x242b36,roughness:.95});
  const hairMaterial=new THREE.MeshStandardMaterial({color:0x342c28,roughness:.92});
  const eyeMaterial=new THREE.MeshStandardMaterial({roughness:.38});
  let skinShader;
  skin.onBeforeCompile=shader=>{skinShader=shader;shader.uniforms.humanBottom={value:skin.userData.minimum||0};shader.uniforms.humanHeight={value:skin.userData.height||17};shader.uniforms.isFemale={value:skin.userData.isFemale||0};shader.uniforms.clothColor={value:new THREE.Color(0x252e40)};shader.vertexShader='varying vec3 humanPosition;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nhumanPosition=position;');shader.fragmentShader='varying vec3 humanPosition; uniform float humanBottom; uniform float humanHeight; uniform float isFemale; uniform vec3 clothColor;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );','float h=(humanPosition.y-humanBottom)/humanHeight; float shortsMask=step(.335,h)*step(h,.535)*step(abs(humanPosition.x),2.0); float topMask=isFemale*step(.665,h)*step(h,.765)*step(abs(humanPosition.x),1.58); vec4 diffuseColor = vec4(mix(diffuse,clothColor,max(shortsMask,topMask)),opacity);');};
  const root=new URL('./assets/human/',import.meta.url);
  const asset=name=>new URL(name+'?v=0.4.0',root);
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error('Не загрузилась модель');return r.json();}
  const meta=await json(asset('model/mesh.json'));
  const texture=await new THREE.TextureLoader().loadAsync(asset('brown_eye.png').href);texture.colorSpace=THREE.SRGBColorSpace;eyeMaterial.map=texture;eyeMaterial.needsUpdate=true;
  const geometry=new THREE.BufferGeometry(),hairGeometry=new THREE.BufferGeometry(),eyesGeometry=new THREE.BufferGeometry();
  const body=new THREE.Mesh(geometry,skin),hair=new THREE.Mesh(hairGeometry,hairMaterial),eyes=new THREE.Mesh(eyesGeometry,eyeMaterial);character.add(body,hair,eyes);
  hairGeometry.setIndex(meta.hair);
  let profile={...initialProfile},level=initialLevel,shapes,loadedSex,active=false,frame=null,angle=0,drag=null,request=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function render(time=0){character.rotation.y=angle;renderer.render(scene,camera);frame=null;}
  function draw(){if(!frame)render();}
  async function loadProfile(value){
    const current=++request,next={...value},changing=loadedSex!==next.sex;
    if(changing){canvas.hidden=true;container.dataset.loading='true';}
    try{
      let data=shapes;
      if(changing){
        const response=await fetch(asset(`model/${next.sex}.bin`));if(!response.ok)throw new Error('Не загрузилась модель');
        data=new Float32Array(await response.arrayBuffer());
        if(data.length!==meta.vertices*9)throw new Error('Повреждены данные модели');
      }
      // An earlier download must never overwrite a more recent profile choice.
      if(current!==request)return;
      profile=next;shapes=data;loadedSex=next.sex;update();canvas.hidden=false;
      canvas.setAttribute('aria-label',`${profile.sex==='female'?'Женская':'Мужская'} модель. Проведи пальцем влево или вправо, чтобы повернуть.`);
      delete container.dataset.unavailable;
    }catch(error){if(current===request){canvas.hidden=true;container.dataset.unavailable='true';}throw error;}
    finally{if(current===request)delete container.dataset.loading;}
  }
  function update(){
    if(!shapes)return;
    const shape=bodyShape(level,profile),count=meta.vertices*3,positions=new Float32Array(count);
    for(let i=0;i<count;i++){const relaxed=shapes[i];positions[i]=relaxed+(shapes[count+i]-relaxed)*shape.softness+(shapes[count*2+i]-relaxed)*shape.trained;}
    let minimum=Infinity,maximum=-Infinity;
    for(let i=1;i<positions.length;i+=3){minimum=Math.min(minimum,positions[i]);maximum=Math.max(maximum,positions[i]);}
    const height=maximum-minimum;
    for(let i=0;i<positions.length;i+=3){const fraction=(positions[i+1]-minimum)/height;const belly=Math.exp(-Math.pow((fraction-.59)/.065,2))*(1-shape.trained);if(positions[i+2]>0&&Math.abs(positions[i])<1.5){positions[i+2]+=.28*belly;positions[i]*=1+.035*belly;}}
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(meta.body);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    if(skinShader){skinShader.uniforms.humanBottom.value=minimum;skinShader.uniforms.humanHeight.value=height;skinShader.uniforms.isFemale.value=profile.sex==='female'?1:0;}
    else{skin.userData={minimum,height,isFemale:profile.sex==='female'?1:0};}
    const headTop=Math.max(...meta.body.map(index=>positions[index*3+1]));
    const hairLength=profile.sex==='female'?3.4:.70;
    const croppedHair=[];for(let i=0;i<meta.hair.length;i+=3){const ids=meta.hair.slice(i,i+3);if(ids.reduce((sum,id)=>sum+positions[id*3+1],0)/3>headTop-hairLength)croppedHair.push(...ids);}
    hairGeometry.setAttribute('position',new THREE.BufferAttribute(positions.slice(),3));hairGeometry.setIndex(croppedHair);hairGeometry.computeVertexNormals();hairGeometry.computeBoundingSphere();
    const eyePositions=[],uv=[];
    for(const [index,uvIndex] of meta.eyes.pairs){const reference=meta.eyes.references[index];eyePositions.push(...positions.slice(reference*3,reference*3+3));uv.push(...meta.eyes.uv[uvIndex]);}
    eyesGeometry.setAttribute('position',new THREE.Float32BufferAttribute(eyePositions,3));eyesGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));eyesGeometry.computeVertexNormals();eyesGeometry.computeBoundingSphere();
    const scale=3.35/height;character.scale.setScalar(scale);character.position.y=-minimum*scale+.06;
    canvas.dataset.level=level;canvas.dataset.sex=profile.sex;canvas.dataset.stage=shape.stage;draw();
  }
  const pedestal=new THREE.Mesh(new THREE.CylinderGeometry(.75,.80,.035,64),new THREE.MeshStandardMaterial({color:0x222934,roughness:1}));pedestal.position.y=.02;scene.add(pedestal);
  function resize(){const {width,height}=container.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();draw();}
  new ResizeObserver(resize).observe(container);
  canvas.addEventListener('pointerdown',event=>{drag={id:event.pointerId,x:event.clientX,angle};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(drag?.id===event.pointerId){angle=drag.angle+(event.clientX-drag.x)*.014;canvas.dataset.rotation=angle;draw();}});
  const finish=()=>{drag=null;};canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();angle+=event.key==='ArrowLeft'?-.25:.25;draw();}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();container.dataset.unavailable='true';});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame){cancelAnimationFrame(frame);frame=null;}else if(active)draw();});
  await loadProfile(initialProfile);resize();container.dataset.ready='true';
  return {setLevel(value){if(level!==value){level=value;update();}},setProfile:loadProfile,setActive(value){active=value;if(!active&&frame){cancelAnimationFrame(frame);frame=null;}if(value){resize();draw();}}};
}
