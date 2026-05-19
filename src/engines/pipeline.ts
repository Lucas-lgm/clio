import type { CaptureEngine } from './capture/engine.js';
import type { InstinctEngine } from './instinct.js';
import type { DecayEngine } from './decay.js';
import type { ProfileEngine } from './profile.js';

export class SessionPipeline {
  constructor(
    private capture: CaptureEngine,
    private instinct: InstinctEngine,
    private decay: DecayEngine,
    private profile: ProfileEngine,
  ) {}

  async processSession(sessionId: string, projectPath?: string): Promise<void> {
    await this.capture.summarizeSession(sessionId, projectPath);
    this.instinct.detect(sessionId);
    this.decay.run();
    this.profile.sync(projectPath);
  }
}
