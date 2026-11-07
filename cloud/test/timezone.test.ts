import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slotOnDate,nextSlotRun,localClock} from '../../lib/schedule';
import {draftNoticeTime} from '../src/notifications';

const examples=[
  ['Asia/Kolkata','09:00','2026-11-07','2026-11-07T03:30:00.000Z'],
  ['Asia/Kathmandu','09:00','2026-11-07','2026-11-07T03:15:00.000Z'],
  ['Pacific/Chatham','09:00','2026-07-15','2026-07-14T20:15:00.000Z'],
  ['America/New_York','09:00','2026-03-08','2026-03-08T13:00:00.000Z'],
  ['America/New_York','02:30','2026-03-08','2026-03-08T07:30:00.000Z'],
  ['America/New_York','01:30','2026-11-01','2026-11-01T05:30:00.000Z'],
  ['Australia/Lord_Howe','02:15','2026-10-04','2026-10-03T15:45:00.000Z'],
];
test('posting instants preserve the selected timezone across DST gaps, folds and fractional offsets',()=>{
  for(const [zone,time,date,expected] of examples)assert.equal(slotOnDate(zone,time,date)?.toISOString(),expected,`${zone} ${date}`);
  assert.equal(nextSlotRun('America/New_York','01:30',127,new Date('2026-11-01T05:31:00Z'))?.toISOString(),'2026-11-02T06:30:00.000Z');
  for(const [zone,time,date] of examples)assert.equal(localClock(zone,slotOnDate(zone,time,date)!).date,date);
});

test('automatic draft alerts wait for the local review window while manual requests notify immediately',()=>{
  const scheduledFor=slotOnDate('Asia/Kolkata','09:00','2026-11-07')!.toISOString();
  const job={kind:'slot' as const,agentId:'test',userId:'test',agentRevision:0,scheduledFor};
  const early=Date.parse('2026-11-07T03:00:00Z');
  assert.equal(draftNoticeTime(job,15,early),'2026-11-07T03:15:00.000Z');
  assert.equal(draftNoticeTime({...job,requested:true},15,early),'2026-11-07T03:00:00.000Z');
  assert.equal(draftNoticeTime(job,15,Date.parse('2026-11-07T03:20:00Z')),'2026-11-07T03:20:00.000Z');
});
