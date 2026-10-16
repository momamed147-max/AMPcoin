import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import {
  Button, Panel, EmptyState, ErrorState, SkeletonRows,
  Badge, StatTile, StatGrid, Tabs, Progress, Amount, compactNumber
} from '../ui/primitives';
import { useApi } from '../ui/useApi';
import './StatsPageV2.css';

const GAMES = [
  { id: 'coinflip', label: 'Coinflip', icon: 'coin', to: '/coinflip' },
  { id: 'jackpot', label: 'Jackpot', icon: 'jackpot', to: '/jackpot' },
  { id: 'rps', label: 'RPS', icon: 'rpsScissors', to: '/rps' },
  { id: 'blackjack', label: 'Blackjack', icon: 'card', to: '/blackjack' },
  { id: 'upgrader', label: 'Upgrader', icon: 'battery', to: '/upgrader' }
];

const TIER_TONE = { bronze: 'gold', silver: '', gold: 'gold', diamond: 'accent' };

function when(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.round(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function StatsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const { data, loading, error, reload } = useApi('/api/progression/summary', {
    onUnauthorized: () => {
      localStorage.removeItem('token');
      window.location.assign('/login');
    }
  });

  const totals = data?.totals;
  const achievements = data?.achievements;
  const games = data?.games;
  const history = data?.history || [];

  const net = totals?.profit || 0;
  const next = achievements?.next;

  const playedGames = useMemo(
    () => GAMES.filter((g) => (games?.[g.id]?.played || 0) > 0),
    [games]
  );

  if (loading && !data) {
    return (
      <div className="sp2">
        <Panel><SkeletonRows rows={4} h={56} /></Panel>
        <div className="sp2-grid-2">
          <Panel><SkeletonRows rows={3} h={90} /></Panel>
          <Panel><SkeletonRows rows={3} h={90} /></Panel>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sp2">
        <Panel>
          <ErrorState title="Could not load your statistics" message={error.message} onRetry={reload} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="sp2">
      <div className="sp2-head">
        {/* No title here. The header band above already says "Statistics"
            and carries the icon and a one-line purpose; repeating it eight
            pixels below, larger, made the most prominent text on the screen
            say the same word twice. This row is only the two things the
            band does not have: the longer explanation, and a way to
            refetch it. */}
        <p className="sp2-sub">
          Everything you have won and lost across every game, and what you have unlocked.
        </p>
        <Button variant="ghost" icon="rpsRock" onClick={reload} loading={loading}>Refresh</Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Overview', icon: 'board' },
          { id: 'games', label: 'By game', icon: 'coin' },
          { id: 'achievements', label: 'Achievements', icon: 'flag', count: achievements?.unlocked },
          { id: 'history', label: 'History', icon: 'target' }
        ]}
      />

      {tab === 'overview' && (
        <>
          <StatGrid>
            <StatTile
              label="Bets played"
              value={compactNumber(totals.played)}
              sub={`${playedGames.length} of ${GAMES.length} games tried`}
              icon="target"
            />
            <StatTile
              label="Win rate"
              value={`${totals.winRate}%`}
              sub={`${totals.wins} won / ${totals.losses} lost`}
              tone={totals.winRate >= 50 ? 'success' : 'danger'}
              icon="jackpot"
            />
            <StatTile
              label="Net profit"
              value={<Amount value={net} sign compact />}
              sub={`${compactNumber(totals.staked)} staked`}
              tone={net > 0 ? 'success' : net < 0 ? 'danger' : undefined}
              icon="diamond"
            />
            <StatTile
              label="Opponents"
              value={compactNumber(totals.distinctOpponents)}
              sub="people played against"
              icon="chat"
            />
          </StatGrid>

          <div className="sp2-grid-2">
            <Panel title="Biggest swings">
              <div className="sp2-rows">
                <div className="sp2-row">
                  <span>Biggest win</span>
                  <Amount value={totals.biggestWin} tone="pos" />
                </div>
                <div className="sp2-row">
                  <span>Biggest loss</span>
                  <Amount value={totals.biggestLoss} tone="neg" />
                </div>
                <div className="sp2-row">
                  <span>Biggest single bet</span>
                  <Amount value={totals.biggestStake} />
                </div>
                <div className="sp2-row">
                  <span>Total staked</span>
                  <Amount value={totals.staked} />
                </div>
              </div>
            </Panel>

            <Panel
              title="Next achievement"
              subtitle={next ? 'The closest one you have not unlocked yet.' : 'You have unlocked everything.'}
            >
              {next ? (
                <div className="sp2-next">
                  <div className="sp2-next-head">
                    <div className={`sp2-medal tier-${next.tier}`}>
                      <Icon name={next.icon} size={17} />
                    </div>
                    <div className="sp2-next-copy">
                      <strong>{next.name}</strong>
                      <span>{next.description}</span>
                    </div>
                    <Badge tone={TIER_TONE[next.tier] || 'neutral'}>{next.tier}</Badge>
                  </div>
                  <Progress value={next.value} max={next.goal} label="Progress" showValue />
                  <div className="sp2-next-foot">
                    <Amount value={next.value} compact /> of <Amount value={next.goal} compact />
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon="check"
                  title="Everything unlocked"
                  message="You have completed every achievement on the site."
                />
              )}
            </Panel>
          </div>

          <Panel title="Recent results" actions={<Button variant="ghost" size="sm" onClick={() => setTab('history')}>See all</Button>}>
            {history.length === 0
              ? <EmptyState icon="card" title="No finished bets yet" message="Play a game and your results will show up here." />
              : <HistoryRows rows={history.slice(0, 8)} />}
          </Panel>
        </>
      )}

      {tab === 'games' && (
        <div className="sp2-game-grid">
          {GAMES.map((g) => {
            const s = games?.[g.id];
            const played = s?.played || 0;
            return (
              <Panel key={g.id} className="sp2-game">
                <div className="sp2-game-head">
                  <Icon name={g.icon} size={16} />
                  <strong>{g.label}</strong>
                  <Badge tone={s?.winRate >= 50 && played > 0 ? 'success' : 'neutral'}>
                    {played > 0 ? `${s.winRate}%` : 'not played'}
                  </Badge>
                </div>
                {played === 0 ? (
                  <EmptyState
                    icon={g.icon}
                    title="Not played yet"
                    action={<Button variant="primary" size="sm" icon="plus" onClick={() => window.location.assign(g.to)}>Play {g.label}</Button>}
                  />
                ) : (
                  <>
                    <StatGrid cols={2}>
                      <StatTile label="Bets" value={compactNumber(played)} />
                      <StatTile label="Won" value={compactNumber(s.wins)} tone="success" />
                      <StatTile label="Staked" value={compactNumber(s.staked)} />
                      <StatTile
                        label="Profit"
                        value={<Amount value={s.profit} sign compact />}
                        tone={s.profit > 0 ? 'success' : s.profit < 0 ? 'danger' : undefined}
                      />
                    </StatGrid>
                    <Progress value={s.winRate} label="Win rate" showValue className="sp2-game-bar" />
                  </>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {tab === 'achievements' && (
        <>
          <Panel
            title={`${achievements.unlocked} of ${achievements.total} unlocked`}
            subtitle="Achievements are earned automatically from the games you already play."
          >
            <Progress value={achievements.unlocked} max={achievements.total} />
          </Panel>
          <div className="sp2-ach-grid">
            {(achievements.list || []).map((a) => (
              <div key={a.id} className={`sp2-ach ${a.unlocked ? 'is-unlocked' : ''}`}>
                <div className={`sp2-medal tier-${a.tier}`}>
                  <Icon name={a.unlocked ? a.icon : 'card'} size={18} />
                </div>
                <div className="sp2-ach-copy">
                  <div className="sp2-ach-head">
                    <strong>{a.name}</strong>
                    <Badge tone={TIER_TONE[a.tier] || 'neutral'}>{a.tier}</Badge>
                  </div>
                  <span className="sp2-ach-desc">{a.description}</span>
                  {a.unlocked
                    ? <span className="sp2-ach-done"><Icon name="check" size={12} /> Unlocked</span>
                    : (
                      <Progress
                        value={a.value}
                        max={a.goal}
                        className="sp2-ach-bar"
                      />
                    )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'history' && (
        <Panel title="Every finished bet" subtitle="Newest first, across all games.">
          {history.length === 0
            ? <EmptyState icon="card" title="No finished bets yet" message="Once you finish a bet it will appear here." action={<Button variant="primary" icon="coin" onClick={() => window.location.assign('/coinflip')}>Play a game</Button>} />
            : <HistoryRows rows={history} detailed />}
        </Panel>
      )}

      <div className="sp2-foot">
        <Link to="/profile" className="sp2-link">Profile settings</Link>
        <span className="sp2-foot-sep" />
        <span className="sp2-foot-note">
          Figures are item values, not AMP cash. Taxes and house edge are already deducted.
        </span>
        {!user?.username && <span className="sp2-foot-note">Signed out.</span>}
      </div>
    </div>
  );
}

function HistoryRows({ rows, detailed = false }) {
  return (
    <div className="sp2-history">
      {rows.map((r) => (
        <div key={r.id} className={`sp2-hrow ${r.won ? 'is-win' : 'is-loss'}`}>
          <span className="sp2-hdot" aria-hidden="true" />
          <div className="sp2-hbody">
            <span className="sp2-hid">{r.id}</span>
            {detailed && r.result && <span className="sp2-hres">{r.result.replace(/_/g, ' ')}</span>}
          </div>
          <span className="sp2-htime">{when(r.at)}</span>
          <span className="sp2-hstake"><Amount value={r.staked} compact /></span>
          <span className="sp2-hprofit"><Amount value={r.profit} sign /></span>
        </div>
      ))}
    </div>
  );
}