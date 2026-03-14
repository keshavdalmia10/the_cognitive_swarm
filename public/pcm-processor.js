class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options?.processorOptions?.targetSampleRate || 16000;
    this.inputSampleRate = sampleRate;
    this.outputBufferSize = 4096;
    this.outputBuffer = new Int16Array(this.outputBufferSize);
    this.outputIndex = 0;
    this.sourceSamples = [];
    this.readIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') {
        this.drainSourceSamples(true);
      }
    };
  }

  pushOutputSample(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcmValue = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7FFF);
    this.outputBuffer[this.outputIndex++] = pcmValue;
    if (this.outputIndex >= this.outputBufferSize) {
      this.flushOutputBuffer();
    }
  }

  flushOutputBuffer(force = false) {
    if (this.outputIndex === 0) {
      return;
    }
    if (!force && this.outputIndex < this.outputBufferSize) {
      return;
    }

    const chunk = this.outputBuffer.slice(0, this.outputIndex);
    this.port.postMessage(chunk.buffer, [chunk.buffer]);
    this.outputIndex = 0;
  }

  drainSourceSamples(force = false) {
    if (this.inputSampleRate === this.targetSampleRate) {
      for (let i = 0; i < this.sourceSamples.length; i++) {
        this.pushOutputSample(this.sourceSamples[i]);
      }
      this.sourceSamples = [];
      this.readIndex = 0;
      if (force) {
        this.flushOutputBuffer(true);
      }
      return;
    }

    const step = this.inputSampleRate / this.targetSampleRate;
    while (this.readIndex + 1 < this.sourceSamples.length) {
      const leftIndex = Math.floor(this.readIndex);
      const rightIndex = leftIndex + 1;
      const fraction = this.readIndex - leftIndex;
      const interpolatedSample =
        this.sourceSamples[leftIndex] +
        (this.sourceSamples[rightIndex] - this.sourceSamples[leftIndex]) * fraction;

      this.pushOutputSample(interpolatedSample);
      this.readIndex += step;
    }

    if (force && this.sourceSamples.length > 0) {
      const lastSample = this.sourceSamples[this.sourceSamples.length - 1];
      while (this.readIndex < this.sourceSamples.length) {
        this.pushOutputSample(lastSample);
        this.readIndex += step;
      }
    }

    const consumedSamples = Math.floor(this.readIndex);
    if (consumedSamples > 0) {
      this.sourceSamples = this.sourceSamples.slice(consumedSamples);
      this.readIndex -= consumedSamples;
    }

    if (force) {
      this.sourceSamples = [];
      this.readIndex = 0;
      this.flushOutputBuffer(true);
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      for (let i = 0; i < channelData.length; i++) {
        this.sourceSamples.push(channelData[i]);
      }
      this.drainSourceSamples(false);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
