import { useEffect, useRef } from 'react';
import { getWorld } from '../sim';
import { applyTurn, awaitingOpening, chooseReply, endConversation, activeProvider } from '../sim/conversation';
import { devMode } from '../sim/dev';
import { useUI } from '../state/store';
import { Portrait } from './Portrait';

/**
 * The general NPC conversation.
 *
 * The visual language Maya's mission scene established, generalised: a portrait
 * on the left for whoever is speaking, a slot on the right for Kai, and the
 * dialogue beneath. Structurally that is the shape a lot of RPGs use, because
 * it puts the two faces where the eye expects them and leaves the world visible
 * between them.
 *
 * What is deliberately absent is the old footer. Live Mode no longer reports
 * "affinity toward you +7" — the player is meant to learn how someone feels
 * from how they speak, not from a number. Those values are still inspectable in
 * Creator Mode, where they are a developer's tool rather than the player's
 * feedback loop.
 *
 * Reads `world.conversation` and never writes it directly: choosing a reply and
 * applying a turn both go through the simulation, which is why the whole flow
 * is testable without a browser.
 */
export function ConversationPanel() {
  useUI((s) => s.uiPulse);
  const bump = useUI((s) => s.bumpPulse);
  const world = getWorld();
  const c = world.conversation;
  const scroller = useRef<HTMLDivElement>(null);
  // Guards against a second provider call for the same turn if React re-renders
  // while one is already in flight.
  const inFlight = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // The opening line, when a remote provider owes us one. Same single request,
  // same guard, same fallback as answering — the first line is not a special
  // case, it just happens to have no player line before it.
  useEffect(() => {
    const pendingOpening = awaitingOpening(world);
    if (!pendingOpening || inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      try {
        const turn = await activeProvider().turn(pendingOpening.context);
        applyTurn(world, turn, pendingOpening.context);
      } finally {
        inFlight.current = false;
        bump();
      }
    })();
  }, [world, c?.settlerId, c?.pending, bump]);

  if (!c) return null;
  const last = c.transcript[c.transcript.length - 1];
  const npcTurn = c.transcript.filter((t) => t.side === 'left').slice(-1)[0];

  const pick = async (id: string) => {
    if (inFlight.current) return;
    const started = chooseReply(world, id);
    if (!started) return;
    inFlight.current = true;
    bump();
    try {
      // One request per deliberate player choice — never per tick, never for
      // ambient chatter. A failure or a timeout resolves to null and the local
      // provider answers instead, so the conversation cannot stall.
      const turn = await activeProvider().turn(started.context);
      applyTurn(world, turn, started.context);
    } finally {
      inFlight.current = false;
      bump();
    }
  };

  const leave = () => {
    endConversation(world);
    bump();
  };

  return (
    <div className="convo-overlay">
      <div className="convo-stage">
        <Portrait
          portraitId={c.portraitId}
          name={c.name}
          mood={npcTurn?.mood ?? 'neutral'}
          side="left"
          // Theirs while they are speaking, and while they are still finding the
          // words — the dots belong to them, so the highlight should too.
          speaking={last?.side === 'left' || c.pending}
        />
        <Portrait
          portraitId="kai"
          name="Kai"
          mood="neutral"
          side="right"
          speaking={last?.side === 'right'}
        />
      </div>

      <div className="convo panel">
        <div className="convo-header">
          <div>
            <span className="convo-name">{last?.side === 'right' ? 'Kai' : c.name}</span>
            <span className="convo-role">{last?.side === 'right' ? 'Independent Pathfinder' : c.role}</span>
          </div>
          <button className="btn close-btn" onClick={leave}>
            ✕
          </button>
        </div>

        <div className="convo-lines" ref={scroller}>
          {c.transcript.map((t, i) => (
            <div
              key={i}
              className={`convo-line ${t.side === 'right' ? 'player' : ''} ${
                i === c.transcript.length - 1 ? 'current' : 'past'
              }`}
            >
              {t.text}
            </div>
          ))}
          {/* Waiting on a line. Says nothing about where it is coming from —
              the player is in a conversation, not watching a network call. */}
          {c.pending && (
            <div className="convo-line thinking">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}
        </div>

        {!c.pending && c.replies.length > 0 && (
          <div className="convo-replies">
            {c.replies.map((r) => (
              <button key={r.id} className="convo-reply" onClick={() => pick(r.id)}>
                {r.text}
              </button>
            ))}
          </div>
        )}

        <div className="convo-footer">
          <span className="convo-hint">Esc to step away</span>
          {/* Which provider spoke is a developer's question, never a player's. */}
          {devMode() && <span className="convo-source">{c.source.toUpperCase()}</span>}
        </div>
      </div>
    </div>
  );
}
