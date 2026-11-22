import { createHash } from 'node:crypto';
import type { ChaosType, CommunicationSnapshot, MessageReceipt } from '@arsu/core';

export class CommunicationReplay {
  private sequence = 0;
  private lastSequence: number | undefined;
  private epoch = 1;
  private received = 0;
  private fault: ChaosType | null = null;
  private receipts: MessageReceipt[] = [];
  private flags = { integrityOk: true, sequenceOk: true, freshnessOk: true };
  private lastGood: MessageReceipt | undefined;

  inject(fault: ChaosType): void { this.fault = fault; }

  tick(now = Date.now()): void {
    this.sequence++;
    const payload = { noticeId: `SIM-${String(this.sequence).padStart(5, '0')}`, airport: 'KJFK', text: 'TRAINING ONLY: modeled runway information update' };
    let packet: MessageReceipt = {
      id: `${this.epoch}-${this.sequence}`, sequence: this.sequence, epoch: this.epoch,
      sentAt: now, receivedAt: now, source: 'notam-source', destination: 'message-consumer',
      topic: 'practice.aeronautical.notices', payload,
      digest: this.digest(payload), outcome: 'accepted', integrityOk: true, sequenceOk: true, freshnessOk: true,
    };
    if (this.fault === 'packet_drop' && this.sequence % 2 === 0) {
      packet.outcome = 'omitted';
      this.retain(packet);
      return;
    }
    if (this.fault === 'packet_replay' && this.lastGood) packet = { ...structuredClone(this.lastGood), id: `${this.epoch}-${this.sequence}-replay`, receivedAt: now };
    if (this.fault === 'packet_corrupt') packet.payload.text = 'TRAINING ONLY: payload changed after checksum';
    if (this.fault === 'packet_stale') packet.sentAt = now - 120_000;
    packet.integrityOk = packet.digest === this.digest(packet.payload);
    packet.sequenceOk = this.lastSequence === undefined || packet.sequence === this.lastSequence + 1;
    packet.freshnessOk = now - packet.sentAt >= 0 && now - packet.sentAt <= 5000;
    this.flags.integrityOk &&= packet.integrityOk;
    this.flags.sequenceOk &&= packet.sequenceOk;
    this.flags.freshnessOk &&= packet.freshnessOk;
    packet.outcome = packet.integrityOk && packet.sequenceOk && packet.freshnessOk ? 'accepted' : 'rejected';
    this.received++;
    this.lastSequence = Math.max(this.lastSequence ?? 0, packet.sequence);
    if (packet.outcome === 'accepted') this.lastGood = structuredClone(packet);
    this.retain(packet);
  }

  repair(now = Date.now()): void {
    this.fault = null;
    this.epoch++;
    this.lastSequence = undefined;
    this.lastGood = undefined;
    this.flags = { integrityOk: true, sequenceOk: true, freshnessOk: true };
    this.tick(now);
  }

  snapshot(): CommunicationSnapshot {
    return { transport: 'in-process educational JSON replay', ...this.flags, published: this.sequence, received: this.received, epoch: this.epoch, receipts: structuredClone(this.receipts) };
  }

  private retain(receipt: MessageReceipt): void {
    this.receipts = [...this.receipts.slice(-23), receipt];
  }

  private digest(payload: MessageReceipt['payload']): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
