// Adjust the selected pin once per explicit selection/geometry change; never on map idle.
window.computePinAdjustment=function({mapRect,sheetRect,sheetHidden,pin,force=false}){
 const w=mapRect.width,h=mapRect.height;if(!(w>0&&h>0&&Number.isFinite(pin.x)&&Number.isFinite(pin.y)))return null;
 const overlaps=!sheetHidden&&sheetRect&&sheetRect.right>mapRect.left&&sheetRect.left<mapRect.right&&sheetRect.top<mapRect.bottom&&sheetRect.bottom>mapRect.top;
 const bottom=overlaps?Math.max(0,Math.min(h,sheetRect.top-mapRect.top)):h;
 const left=24,right=w-24,top=44,safeBottom=bottom-16;if(right<=left||safeBottom<=top)return null;
 if(!force&&pin.x>=left&&pin.x<=right&&pin.y>=top&&pin.y<=safeBottom)return null;
 return {x:pin.x-(left+right)/2,y:pin.y-(top+safeBottom)/2};
};
window.createPinVisibilityController=function({getMap,getCoordinate,mapElement,sheetElement,makePoint=(x,y)=>({x,y})}){
 let dragging=false,frame=null,forcePending=false,observer=null;
 function cancel(){if(frame!==null)cancelAnimationFrame(frame);frame=null;forcePending=false;}
 function adjust(force){if(dragging)return;const map=getMap(),coord=getCoordinate();if(!map||!coord||sheetElement.hidden)return;const projection=map.getProjection();const pin=projection.fromCoordToOffset(coord),center=projection.fromCoordToOffset(map.getCenter());const delta=window.computePinAdjustment({mapRect:mapElement.getBoundingClientRect(),sheetRect:sheetElement.getBoundingClientRect(),sheetHidden:sheetElement.hidden,pin,force});if(!delta||Math.hypot(delta.x,delta.y)<1)return;map.setCenter(projection.fromOffsetToCoord(makePoint(center.x+delta.x,center.y+delta.y)));}
 function request(force=false){if(dragging)return;forcePending=forcePending||force;if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;const force=forcePending;forcePending=false;adjust(force);});}
 function interactionStart(){dragging=true;cancel();}function interactionEnd(){dragging=false;}
 function observe(){if(observer)return;if(window.ResizeObserver){observer=new ResizeObserver(()=>request(false));observer.observe(sheetElement);}mapElement.addEventListener('pointerdown',interactionStart,{passive:true});window.addEventListener('pointerup',interactionEnd,{passive:true});window.addEventListener('pointercancel',interactionEnd,{passive:true});mapElement.addEventListener('touchstart',interactionStart,{passive:true});window.addEventListener('touchend',interactionEnd,{passive:true});window.addEventListener('touchcancel',interactionEnd,{passive:true});mapElement.addEventListener('wheel',cancel,{passive:true});}
 return {request,cancel,interactionStart,interactionEnd,observe};
};
