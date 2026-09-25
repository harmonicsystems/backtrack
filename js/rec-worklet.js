// Captures the mic on the AudioContext's own clock: every chunk carries the frame it started at, so a take can be
// lined up with the groove to the sample (MediaRecorder's start time is only known to tens of milliseconds).
class RecTap extends AudioWorkletProcessor {
  constructor(){
    super();
    this.buf = new Float32Array(4096); this.n = 0; this.at = 0; this.live = true;
    this.port.onmessage = e => { if(e.data === 'stop'){ this.flush(); this.live = false; this.port.postMessage({ done:true }); } };
  }
  flush(){
    if(!this.n) return;
    const pcm = this.buf.slice(0, this.n);
    this.port.postMessage({ frame:this.at, pcm }, [pcm.buffer]);
    this.n = 0;
  }
  process(inputs){
    if(!this.live) return false;
    const ch = inputs[0] && inputs[0][0];
    if(ch && ch.length){
      if(this.n && this.at + this.n !== currentFrame) this.flush();          // a gap in the input: start a new chunk
      if(this.n + ch.length > this.buf.length) this.flush();
      if(!this.n) this.at = currentFrame;
      this.buf.set(ch, this.n); this.n += ch.length;
    }
    return true;
  }
}
registerProcessor('rec-tap', RecTap);
