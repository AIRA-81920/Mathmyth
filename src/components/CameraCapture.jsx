import { useEffect, useRef, useState } from 'react';
import ModalFrame from './ModalFrame.jsx';
export default function CameraCapture({ onPhoto, onClose }) {
  const video = useRef(null), stream = useRef(null);
  const [ready,setReady] = useState(false), [error,setError] = useState('');
  useEffect(() => {
    let live = true;
    async function open() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error();
        const camera = await navigator.mediaDevices.getUserMedia({ video:{facingMode:{ideal:'environment'}},audio:false });
        if (!live) { camera.getTracks().forEach(track=>track.stop()); return; }
        stream.current = camera; video.current.srcObject = camera; await video.current.play(); if(live)setReady(true);
      } catch { if(live)setError('暂时无法打开摄像头，请允许相机访问，或改用相册 / 文件。'); }
    }
    open();
    return () => { live=false;stream.current?.getTracks().forEach(track=>track.stop()); };
  },[]);
  async function capture() {
    if (!ready || !video.current?.videoWidth) return;
    const canvas=document.createElement('canvas');canvas.width=video.current.videoWidth;canvas.height=video.current.videoHeight;
    canvas.getContext('2d').drawImage(video.current,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));canvas.width=canvas.height=0;
    if(blob)onPhoto(new File([blob],`拍照-${Date.now()}.jpg`,{type:'image/jpeg'}));
  }
  return <ModalFrame open titleId="camera-title" className="confirm-dialog camera-capture" onClose={onClose}>
    <h2 id="camera-title">拍照</h2><video ref={video} muted playsInline className="camera-preview" />
    {error && <p role="status">{error}</p>}
    <div className="dialog-actions"><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={!ready} onClick={capture}>拍照</button></div>
  </ModalFrame>;
}
