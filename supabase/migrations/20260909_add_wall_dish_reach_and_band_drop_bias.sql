-- Three generation parameters were reachable from the UI but had nowhere to live, so
-- they reset to their defaults on every reload. Nullable with no default so existing
-- rows stay untouched and the client can tell "never saved" from an explicit value.
--
-- The band falloff shape is set per side: the lateral arch is short and its band
-- narrow, so it has little height to give away and keeps the original shape (1.0),
-- while the medial band - tall enough to swamp the transverse arch - is reshaped (2.0).
alter table public.insole_designs
    add column if not exists wall_dish_reach_mm double precision,
    add column if not exists medial_band_drop_bias double precision,
    add column if not exists lateral_band_drop_bias double precision;

comment on column public.insole_designs.wall_dish_reach_mm is
    'Heel cup dish reach in mm: how far inward from the rim the dish extends. Engine default 10.0.';
comment on column public.insole_designs.medial_band_drop_bias is
    'Medial arch band drop bias (exponent on t in _band_profile_height). 1.0 = falls hardest at the solid boundary; higher values fall just inside the dashed boundary and land tangentially on the solid one. Engine default 2.0.';
comment on column public.insole_designs.lateral_band_drop_bias is
    'Lateral arch band drop bias, same meaning as the medial one. Engine default 1.0 (original shape).';

-- Angle at which the underside leaves the flat bottom (the first of the wall's two
-- stages). Nullable so existing rows fall back to the engine default of 17.
alter table public.insole_designs
    add column if not exists wall_first_stage_deg double precision;

comment on column public.insole_designs.wall_first_stage_deg is
    'Angle in degrees from horizontal at which the underside leaves the flat bottom. A single curve cannot be steep at the bottom because the rise is fixed and the run is whatever the drawn clearance gives, so a straight first stage at this angle is combined with the eased curve by a smooth maximum, capped per rim point so the second stage always survives. 0 disables it. Range 0-15, engine default 15.';
