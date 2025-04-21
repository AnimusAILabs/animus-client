import { describe, it, expect } from 'vitest';
import { AnimusClient } from '../src/AnimusClient';

describe('AnimusClient', () => {
  it('should instantiate without errors with minimal options', () => {
    expect(() => new AnimusClient({ tokenProviderUrl: 'http://localhost:3001/token' })).not.toThrow();
  });

  it('should have a chat property', () => {
    const client = new AnimusClient({ tokenProviderUrl: 'http://localhost:3001/token' });
    expect(client.chat).toBeDefined();
  });

  it('should have a media property', () => {
    const client = new AnimusClient({ tokenProviderUrl: 'http://localhost:3001/token' });
    expect(client.media).toBeDefined();
  });
});