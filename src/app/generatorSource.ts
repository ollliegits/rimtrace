import { createGenerator, type Generator, type ScenarioName } from '../generator';
import type { Frame, FrameSource } from './frameSource';

export class GeneratorSource implements FrameSource {
  private gen: Generator;

  constructor(private readonly scenario: ScenarioName = 'ideal') {
    this.gen = createGenerator(scenario);
  }

  get width(): number {
    return this.gen.setup.width;
  }

  get height(): number {
    return this.gen.setup.height;
  }

  read(): Frame {
    return this.gen.next();
  }

  groundTruth() {
    return this.gen.truthAtSpokes();
  }

  restart(): void {
    this.gen = createGenerator(this.scenario);
  }
}
