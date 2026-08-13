import { getWorld } from '../sim';
import {
  MATERIALS,
  RECIPES,
  RECIPE_BY_ID,
  alreadyBuilt,
  canFabricate,
  fabricationProgress,
  startFabrication,
} from '../sim/fabrication';
import type { MaterialId, SalvageId } from '../sim/types';
import { useUI } from '../state/store';

/**
 * The Fabricator interface.
 *
 * Reads simulation state and calls into it; it owns nothing. The button cannot
 * make an item — it asks `startFabrication`, which is the only thing that
 * consumes materials, so a double-click or a mid-job speed change can never
 * produce two of anything.
 *
 * The world stays visible behind it: this is a machine Kai is standing at,
 * not a menu he opened.
 */
export function FabricatorPanel() {
  useUI((s) => s.uiPulse);
  const setOpen = useUI((s) => s.setFabricatorOpen);
  const world = getWorld();
  const p = world.player;
  const job = world.fabrication;
  const progress = fabricationProgress(world);

  return (
    <div className="fab-overlay" onClick={() => setOpen(false)}>
      <div className="fab panel" onClick={(e) => e.stopPropagation()}>
        <div className="fab-header">
          <div>
            <div className="fab-title">COLONY FABRICATOR</div>
            <div className="fab-sub">Human Landing · feedstock-limited</div>
          </div>
          <button className="btn close-btn" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <div className="fab-stock">
          {(Object.keys(MATERIALS) as MaterialId[]).map((id) => (
            <div key={id} className="fab-stock-item">
              <span className="fab-swatch" style={{ background: MATERIALS[id].color }} />
              <span className="fab-stock-name">{MATERIALS[id].name}</span>
              <span className="fab-stock-count">{p.materials[id]}</span>
            </div>
          ))}
        </div>

        {job && (
          <div className="fab-running">
            <div className="fab-running-label">
              FABRICATING · {RECIPE_BY_ID[job.recipeId]?.name ?? job.recipeId}
            </div>
            <div className="bar fab-bar">
              <div className="bar-fill tone-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="fab-recipes">
          {RECIPES.map((recipe) => {
            const built = alreadyBuilt(world, recipe);
            const check = canFabricate(world, recipe.id);
            const costs = Object.entries(recipe.costs) as [MaterialId, number][];
            const salvageCosts = Object.entries(recipe.salvage ?? {}) as [SalvageId, number][];
            return (
              <div key={recipe.id} className={`fab-recipe ${check.ok ? 'ready' : ''} ${built ? 'built' : ''}`}>
                <div className="fab-recipe-head">
                  <span className="fab-recipe-name">{recipe.name}</span>
                  {built && <span className="fab-tag">INSTALLED</span>}
                </div>
                <div className="fab-recipe-desc">{recipe.description}</div>
                <div className="fab-costs">
                  {costs.map(([id, need]) => {
                    const have = p.materials[id];
                    return (
                      <span key={id} className={`fab-cost ${have >= need ? 'met' : 'short'}`}>
                        <span className="fab-swatch" style={{ background: MATERIALS[id].color }} />
                        {MATERIALS[id].name} {have} / {need}
                      </span>
                    );
                  })}
                  {/* Salvage reads differently from ore on purpose: one is a
                      shopping trip, the other means going back out there. */}
                  {salvageCosts.map(([id, need]) => (
                    <span
                      key={id}
                      className={`fab-cost salvage ${p.salvage[id] >= need ? 'met' : 'short'}`}
                    >
                      <span className="fab-swatch" style={{ background: '#7fe7ff' }} />
                      Synthetic Core Fragment {p.salvage[id]} / {need}
                    </span>
                  ))}
                </div>
                {recipe.note && <div className="fab-note">{recipe.note}</div>}
                <button
                  className="btn fab-button"
                  disabled={!check.ok}
                  onClick={() => startFabrication(world, recipe.id)}
                >
                  {built
                    ? 'ALREADY INSTALLED'
                    : job
                      ? 'FABRICATOR BUSY'
                      : check.ok
                        ? 'FABRICATE'
                        : check.reason === 'missing-salvage'
                          ? 'NEEDS SYNTHETIC SALVAGE'
                          : 'INSUFFICIENT MATERIAL'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="fab-footer">
          Carrying: {p.items.medkit} medkit{p.items.medkit === 1 ? '' : 's'} · {p.items.energyCell} energy cell
          {p.items.energyCell === 1 ? '' : 's'}
          {p.unlocks.scanner ? ' · Scanner Mk I installed' : ''}
          {p.unlocks.arcBlade ? ' · Arc Blade Mk I' : ''}
          {p.salvage.coreFragment > 0
            ? ` · ${p.salvage.coreFragment} core fragment${p.salvage.coreFragment === 1 ? '' : 's'} — Petra has no idea what they are`
            : ''}
        </div>
      </div>
    </div>
  );
}
