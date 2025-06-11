// This class is the AudioWorklet processor.
// It runs in a separate background thread to process audio efficiently without freezing the UI.
class AudioDataProcessor extends AudioWorkletProcessor {
  process(inputs) {
    // Get the raw audio data (Float32Array) from the microphone.
    const inputData = inputs[0][0];

    if (inputData) {
      // Post the raw audio data back to the main UI thread.
      // The main thread will then convert it and send it over the WebSocket.
      this.port.postMessage(inputData);
    }

    // Return true to keep the processor alive and listening for more audio.
    return true;
  }
}

// Register the processor with the name 'audio-data-processor' so we can use it in our React component.
registerProcessor('audio-data-processor', AudioDataProcessor);