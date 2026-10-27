use wasm_bindgen::prelude::*;
use crate::hypot;

fn radius(n: f64) -> f64 { 4.0 + n.sqrt() * 0.32 }
fn dist(x: f64, y: f64, xx: f64, yy: f64) -> f64 { hypot(x - xx, y - yy) }
fn round(n: f64) -> f64 {
    let low = n.floor(); let value = if n - low >= 0.5 { low + 1.0 } else { low };
    if value == 0.0 && n < 0.0 { -0.0 } else { value }
}

// Entity fields are stored together so simulation updates do not cross the
// JavaScript/Wasm boundary. The flat representation is only used when loading
// or exporting a snapshot.
#[derive(Clone)]
struct Swarm {
    id: f64, side: usize, x: f64, y: f64, n: f64, tx: f64, ty: f64,
    manual: bool, rule: f64, no_merge: f64, eng: bool, belly: f64,
    meal: f64, roll: Option<bool>,
}

#[derive(Clone)]
struct Planet {
    x: f64, y: f64, r: f64, owner: i32, cap: f64, id: f64, m0: f64,
    mass: f64, stock: f64, prog: f64, claim: i32, by: i32,
}

#[derive(Clone)]
struct Rule { condition: usize, action: usize, p: f64, on: bool, explicit_p: bool }

#[wasm_bindgen]
pub struct RustMatch {
    seed: JsValue, options: String,
    teams: Vec<u32>, tick: f64, end_tick: f64, next_id: f64,
    swarms: Vec<Swarm>, planets: Vec<Planet>, rules: Vec<Vec<Rule>>,
    winner: i32, reason: u8,
}

impl RustMatch {
    fn visible(&self, side: usize) -> Vec<usize> {
        let mut out = Vec::new();
        for (i, enemy) in self.swarms.iter().enumerate() {
            if self.teams[enemy.side] == self.teams[side] { continue; }
            let er = radius(enemy.n);
            if self.swarms.iter().any(|c| self.teams[c.side] == self.teams[side] && dist(c.x, c.y, enemy.x, enemy.y) < 150.0 + radius(c.n) + er)
                || self.planets.iter().any(|p| p.owner >= 0 && self.teams[p.owner as usize] == self.teams[side] && dist(p.x, p.y, enemy.x, enemy.y) < p.r + 80.0 + er) { out.push(i); }
        }
        out
    }

    fn nearest_swarm(&self, c: &Swarm, indices: impl Iterator<Item = usize>, max: f64) -> Option<usize> {
        let mut best = None; let mut bd = max;
        for i in indices { let o = &self.swarms[i]; let d = dist(c.x, c.y, o.x, o.y); if d < bd { bd = d; best = Some(i); } }
        best
    }

    fn nearest_planet(&self, c: &Swarm, indices: impl Iterator<Item = usize>, max: f64) -> Option<usize> {
        let mut best = None; let mut bd = max;
        for i in indices { let o = &self.planets[i]; let d = dist(c.x, c.y, o.x, o.y); if d < bd { bd = d; best = Some(i); } }
        best
    }

    // Some(None) represents the truthy `always` condition, which has no coordinates.
    fn condition(&self, i: usize, rule: &Rule, vis: &[usize]) -> Option<Option<(f64, f64)>> {
        let c = &self.swarms[i]; let p = rule.p;
        let swarm = |index: Option<usize>| index.map(|j| Some((self.swarms[j].x, self.swarms[j].y)));
        let planet = |index: Option<usize>| index.map(|j| Some((self.planets[j].x, self.planets[j].y)));
        match rule.condition {
            0 => swarm(self.nearest_swarm(c, vis.iter().copied().filter(|&j| self.swarms[j].n >= c.n * p), 170.0)),
            1 => swarm(self.nearest_swarm(c, vis.iter().copied().filter(|&j| self.swarms[j].n <= c.n * p), 230.0)),
            2 => swarm(self.nearest_swarm(c, vis.iter().copied(), p)),
            3 => planet(self.nearest_planet(c, (0..self.planets.len()).filter(|&j| {
                let o = &self.planets[j];
                o.owner == c.side as i32 && o.mass > 0.0 && vis.iter().any(|&k| dist(o.x, o.y, self.swarms[k].x, self.swarms[k].y) < o.r + 70.0)
            }), p)),
            4 if c.n < p => swarm(self.nearest_swarm(c, (0..self.swarms.len()).filter(|&j| j != i && self.swarms[j].side == c.side), f64::INFINITY)),
            5 if c.n > p => Some(Some((c.x, c.y))),
            6 if ((self.tick - c.meal) / 400.0).min(1.0) >= p => planet(self.nearest_planet(c, (0..self.planets.len()).filter(|&j| self.planets[j].mass > 0.0), f64::INFINITY)),
            7 if c.belly > c.n * p => Some(Some((c.x, c.y))),
            8 => planet(self.nearest_planet(c, (0..self.planets.len()).filter(|&j| self.planets[j].owner == -1 && self.planets[j].mass > 0.0), p)),
            9 => planet(self.nearest_planet(c, (0..self.planets.len()).filter(|&j| { let o = &self.planets[j]; o.owner >= 0 && self.teams[o.owner as usize] != self.teams[c.side] && o.mass > 0.0 }), p)),
            10 => Some(None),
            _ => None,
        }
    }

    fn action(&mut self, i: usize, action: usize, target: Option<(f64, f64)>) -> bool {
        let c = &self.swarms[i];
        let point = match action {
            0 => target,
            1 => {
                let near = self.nearest_swarm(c, (0..self.swarms.len()).filter(|&j| j != i && self.swarms[j].side == c.side && self.swarms[j].n >= c.n / 2.0), f64::INFINITY);
                Some(near.map(|j| (self.swarms[j].x, self.swarms[j].y)).unwrap_or((self.planets[c.side].x, self.planets[c.side].y)))
            },
            2 => return self.split(i, false),
            3 => Some((c.x, c.y)),
            _ => None,
        };
        if let Some((x, y)) = point { self.swarms[i].tx = x; self.swarms[i].ty = y; true } else { false }
    }

    fn split(&mut self, i: usize, manual: bool) -> bool {
        let c = &self.swarms[i];
        if c.n < 200.0 { return false; }
        let (side, x, y, n) = (c.side, c.x, c.y, c.n);
        if self.add_swarm(side, x + 4.0, y + 4.0, n / 2.0) < 0.0 { return false; }
        let j = self.swarms.len() - 1;
        self.swarms[i].n /= 2.0; self.swarms[i].belly /= 2.0;
        self.swarms[j].belly = self.swarms[i].belly; self.swarms[j].meal = self.swarms[i].meal;
        self.swarms[i].manual = manual; self.swarms[j].manual = manual;
        self.swarms[i].no_merge = self.tick + 80.0; self.swarms[j].no_merge = self.tick + 80.0;
        let mut planets: Vec<usize> = (0..self.planets.len()).filter(|&k| self.planets[k].mass > 0.0 && self.planets[k].owner != side as i32).collect();
        planets.sort_by(|&a, &b| {
            let p = &self.planets[a]; let o = &self.planets[b];
            (dist(x, y, p.x, p.y) - dist(x, y, o.x, o.y)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| p.id.partial_cmp(&o.id).unwrap_or(std::cmp::Ordering::Equal))
        });
        let (tx, ty) = planets.get(1).map(|&k| (self.planets[k].x, self.planets[k].y)).unwrap_or((x, (y + 80.0).min(690.0)));
        self.swarms[j].tx = tx; self.swarms[j].ty = ty;
        true
    }
}

#[wasm_bindgen]
impl RustMatch {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: JsValue, options: String, teams: &[u32], tick: f64, end_tick: f64, next_id: f64, swarms: &[f64], planets: &[f64]) -> RustMatch {
        let swarms = swarms.chunks_exact(14).map(|c| Swarm {
            id: c[0], side: c[1] as usize, x: c[2], y: c[3], n: c[4], tx: c[5], ty: c[6],
            manual: c[7] != 0.0, rule: c[8], no_merge: c[9], eng: c[10] != 0.0,
            belly: c[11], meal: c[12], roll: if c[13].is_nan() { None } else { Some(c[13] != 0.0) },
        }).collect();
        let planets = planets.chunks_exact(12).map(|p| Planet {
            x: p[0], y: p[1], r: p[2], owner: p[3] as i32, cap: p[4], id: p[5],
            m0: p[6], mass: p[7], stock: p[8], prog: p[9], claim: p[10] as i32, by: p[11] as i32,
        }).collect();
        RustMatch { seed, options, teams: teams.to_vec(), tick, end_tick, next_id, swarms, planets, rules: vec![Vec::new(); teams.len()], winner: -1, reason: 0 }
    }

    pub fn swarm_snapshot(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.swarms.len() * 14);
        for c in &self.swarms {
            out.extend_from_slice(&[c.id, c.side as f64, c.x, c.y, c.n, c.tx, c.ty,
                c.manual as u8 as f64, c.rule, c.no_merge, c.eng as u8 as f64,
                c.belly, c.meal, c.roll.map_or(f64::NAN, |v| v as u8 as f64)]);
        }
        out
    }

    pub fn planet_snapshot(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.planets.len() * 12);
        for p in &self.planets {
            out.extend_from_slice(&[p.x, p.y, p.r, p.owner as f64, p.cap, p.id,
                p.m0, p.mass, p.stock, p.prog, p.claim as f64, p.by as f64]);
        }
        out
    }

    pub fn tick(&self) -> f64 { self.tick }
    pub fn seed(&self) -> JsValue { self.seed.clone() }
    pub fn options(&self) -> String { self.options.clone() }
    pub fn end_tick(&self) -> f64 { self.end_tick }
    pub fn next_id(&self) -> f64 { self.next_id }
    pub fn teams(&self) -> Vec<u32> { self.teams.clone() }

    // Each rule is condition index, action index, effective parameter, enabled, explicit parameter.
    pub fn set_rules(&mut self, side: usize, rules: &[f64]) {
        self.rules[side] = rules.chunks_exact(5).map(|r| Rule {
            condition: r[0] as usize, action: r[1] as usize, p: r[2], on: r[3] != 0.0, explicit_p: r[4] != 0.0,
        }).collect();
    }

    pub fn rule_snapshot(&self, side: usize) -> Vec<f64> {
        self.rules[side].iter().flat_map(|r| [r.condition as f64, r.action as f64, r.p, r.on as u8 as f64, r.explicit_p as u8 as f64]).collect()
    }

    pub fn outcome(&self) -> Vec<i32> { vec![self.winner, self.reason as i32] }
    pub fn set_outcome(&mut self, winner: i32, reason: u8) { self.winner = winner; self.reason = reason; }
    pub fn visible_indices(&self, side: usize) -> Vec<u32> { self.visible(side).into_iter().map(|i| i as u32).collect() }
    pub fn view_header(&self, side: usize) -> Vec<f64> {
        let result = if self.reason == 0 { -1.0 } else if self.winner == self.teams[side] as i32 { 0.0 } else if self.winner < 0 { 1.0 } else { 2.0 };
        vec![((self.end_tick - self.tick) / 20.0).ceil().max(0.0), result]
    }
    pub fn view_totals(&self, side: usize) -> Vec<f64> {
        let team = self.teams[side]; let sums = self.team_populations();
        let mut foes = Vec::new(); for &t in &self.teams { if t != team && !foes.contains(&t) { foes.push(t); } }
        let mut out = vec![round(sums[team as usize]), round(foes.iter().map(|&t| sums[t as usize]).fold(0.0, f64::max))];
        out.extend(foes.iter().map(|&t| round(sums[t as usize]))); out
    }
    pub fn view_swarms(&self, side: usize, kind: u8) -> Vec<f64> {
        let team = self.teams[side];
        let mut foes = Vec::new(); for &t in &self.teams { if t != team && !foes.contains(&t) { foes.push(t); } }
        let visible = if kind == 2 { self.visible(side) } else { Vec::new() };
        let mut out = Vec::new();
        for (i, c) in self.swarms.iter().enumerate() {
            if kind == 0 && c.side == side {
                out.extend_from_slice(&[c.id, round(c.x), round(c.y), round(c.n), round(c.tx), round(c.ty), c.manual as u8 as f64, c.rule, c.eng as u8 as f64, round(c.belly), round(((self.tick - c.meal) / 400.0).min(1.0) * 100.0) / 100.0]);
            } else if kind == 1 && c.side != side && self.teams[c.side] == team {
                out.extend_from_slice(&[c.id, round(c.x), round(c.y), round(c.n), c.eng as u8 as f64]);
            } else if kind == 2 && visible.contains(&i) {
                let k = foes.iter().position(|&t| t == self.teams[c.side]).unwrap_or(0);
                out.extend_from_slice(&[c.id, k as f64, round(c.x), round(c.y), round(c.n), c.eng as u8 as f64]);
            }
        }
        out
    }
    pub fn view_planets(&self, side: usize) -> Vec<f64> {
        let team = self.teams[side];
        let mut foes = Vec::new(); for &t in &self.teams { if t != team && !foes.contains(&t) { foes.push(t); } }
        let k = |s: usize| foes.iter().position(|&t| t == self.teams[s]).unwrap_or(0) as f64;
        let mut out = Vec::new();
        for p in &self.planets {
            let owner = if p.owner < 0 { -1.0 } else if p.owner as usize == side { 0.0 } else if self.teams[p.owner as usize] == team { 1.0 } else { 2.0 };
            let color = if p.owner >= 0 { k(p.owner as usize) } else if p.prog > 0.0 { k(p.claim as usize) } else { 0.0 };
            let capture = if p.owner >= 0 { if self.teams[p.owner as usize] == team { p.cap } else { -p.cap } }
                else if p.prog > 0.0 { if self.teams[p.claim as usize] == team { p.prog } else { -p.prog } } else { 0.0 };
            out.extend_from_slice(&[p.id, round(p.x), round(p.y), p.r, owner, color, round(p.mass), p.m0, round(capture * 100.0) / 100.0, k(p.by.max(0) as usize)]);
        }
        out
    }
    pub fn populations(&self) -> Vec<f64> {
        let mut sums = vec![0.0; self.teams.len()];
        for c in &self.swarms { sums[c.side] += c.n; }
        sums.into_iter().map(|n| { let lower = n.floor(); if n - lower >= 0.5 { lower + 1.0 } else { lower } }).collect()
    }
    fn team_populations(&self) -> Vec<f64> {
        let mut sums = vec![0.0; self.teams.iter().copied().max().unwrap_or(0) as usize + 1];
        for c in &self.swarms { sums[self.teams[c.side] as usize] += c.n; }
        sums
    }

    pub fn surrender(&mut self, side: usize) {
        let own = self.teams[side]; let mut teams: Vec<(u32, f64)> = Vec::new();
        for c in &self.swarms {
            let team = self.teams[c.side]; if team == own { continue; }
            if let Some(entry) = teams.iter_mut().find(|x| x.0 == team) { entry.1 += c.n; } else { teams.push((team, c.n)); }
        }
        teams.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
        self.winner = teams.first().map(|x| x.0).or_else(|| self.teams.iter().copied().find(|&t| t != own)).map_or(-1, |x| x as i32);
        self.reason = 3;
    }

    pub fn advance(&mut self) {
        if self.reason != 0 { return; }
        self.tick += 1.0;
        if self.tick % 10.0 == 0.0 { self.think(); }
        self.physics(self.tick);
        self.grow_planets();
        let mut alive = Vec::new();
        for side in 0..self.teams.len() {
            if (self.swarms.iter().any(|c| c.side == side) || self.planets.iter().any(|p| p.owner == side as i32 && p.mass > 0.0)) && !alive.contains(&self.teams[side]) { alive.push(self.teams[side]); }
        }
        if alive.len() <= 1 { self.winner = alive.first().map_or(-1, |&v| v as i32); self.reason = 1; }
        else if self.tick >= self.end_tick {
            let totals = self.team_populations(); let best = totals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            self.winner = if totals.iter().filter(|&&n| n == best).count() > 1 { -1 } else { totals.iter().position(|&n| n == best).unwrap() as i32 };
            self.reason = 2;
        }
    }
    pub fn advance_to(&mut self, tick: f64) { while self.reason == 0 && self.tick < tick { self.advance(); } }
    pub fn finish(&mut self) { while self.reason == 0 { self.advance(); } }

    pub fn toggle_rule(&mut self, side: usize, index: usize) -> bool {
        if let Some(r) = self.rules.get_mut(side).and_then(|rules| rules.get_mut(index)) { r.on = !r.on; true } else { false }
    }

    pub fn set_order(&mut self, side: usize, id: f64, x: f64, y: f64) -> bool {
        if let Some(c) = self.swarms.iter_mut().find(|c| c.side == side && c.id == id) {
            c.manual = true; c.tx = x.max(0.0).min(1200.0); c.ty = y.max(0.0).min(700.0); true
        } else { false }
    }

    pub fn release(&mut self, side: usize, id: f64) -> bool {
        if let Some(c) = self.swarms.iter_mut().find(|c| c.side == side && c.id == id) { c.manual = false; true } else { false }
    }

    // Return 0 for missing swarm, 1 for success and 2 when it cannot split.
    pub fn split_id(&mut self, side: usize, id: f64) -> u8 {
        if let Some(i) = self.swarms.iter().position(|c| c.side == side && c.id == id) {
            if self.split(i, self.swarms[i].manual) { 1 } else { 2 }
        } else { 0 }
    }

    fn think(&mut self) {
        let vis: Vec<Vec<usize>> = (0..self.teams.len()).map(|side| self.visible(side)).collect();
        let count = self.swarms.len();
        for i in 0..count {
            if self.swarms[i].manual { continue; }
            let side = self.swarms[i].side;
            let rules = self.rules[side].clone();
            let mut selected = -1.0;
            for (index, rule) in rules.iter().enumerate() {
                if !rule.on { continue; }
                if let Some(target) = self.condition(i, rule, &vis[side]) {
                    if self.action(i, rule.action, target) { selected = index as f64; break; }
                }
            }
            self.swarms[i].rule = selected;
        }
    }

    // Tick is advanced by the caller before this phase, matching the order in
    // the original simulation (gambits precede movement and combat).
    fn physics(&mut self, tick: f64) {
        self.tick = tick;
        for c in &mut self.swarms {
            let d = dist(c.x, c.y, c.tx, c.ty);
            let size = c.n / 15000.0;
            let speed = 1.5 - (if size.is_nan() { f64::NAN } else { size.min(1.0) }) * 0.9;
            let limit = speed * if c.eng && !c.roll.unwrap_or(false) { 0.25 } else { 1.0 } / (1.0 + 2.0 * c.belly / c.n);
            let v = if d.is_nan() || limit.is_nan() { f64::NAN } else { d.min(limit) };
            if d > 1.0 { c.x += (c.tx - c.x) / d * v; c.y += (c.ty - c.y) / d * v; }
        }
        let len = self.swarms.len();
        let mut losses = vec![0.0; len];
        let mut gains = vec![0.0; len];
        let mut engaged = vec![false; len];
        let mut rolling = vec![false; len];
        let mut hits = Vec::new();
        for i in 0..len {
            for j in i + 1..len {
                let a = &self.swarms[i]; let b = &self.swarms[j];
                if self.teams[a.side] == self.teams[b.side] { continue; }
                let ra = radius(a.n); let rb = radius(b.n);
                if !(dist(a.x, a.y, b.x, b.y) < ra + rb) { continue; }
                let front = 2.0 * ra.min(rb);
                let ka = b.n.min(0.2 * front * (1.0 + 3.0 * (ra / rb - 1.0).max(0.0).min(1.0)));
                let kb = a.n.min(0.2 * front * (1.0 + 3.0 * (rb / ra - 1.0).max(0.0).min(1.0)));
                losses[j] += ka; losses[i] += kb;
                if ka > 0.0 { hits.push((i, j, ka)); }
                if kb > 0.0 { hits.push((j, i, kb)); }
                engaged[i] = true; engaged[j] = true;
                if ka > kb { rolling[i] = true; }
                if kb > ka { rolling[j] = true; }
            }
        }
        for (attacker, target, damage) in hits {
            gains[attacker] += 0.5 * damage * (self.swarms[target].n / losses[target]).min(1.0);
        }
        for (i, c) in self.swarms.iter_mut().enumerate() {
            c.eng = engaged[i]; c.roll = Some(rolling[i]);
            if c.eng { c.n = (c.n - losses[i]).max(0.0); }
            if c.n > 0.0 && gains[i] > 0.0 { c.belly += gains[i]; c.meal = tick; }
        }
        for c in &mut self.swarms {
            if c.n > 0.0 && c.belly > 0.0 { let d = c.belly.min(c.n * 0.004); c.belly -= d; c.n += d; }
        }
        for i in 0..len {
            for j in i + 1..len {
                let (first, rest) = self.swarms.split_at_mut(j);
                let a = &mut first[i]; let b = &mut rest[0];
                if a.side == b.side && a.n > 0.0 && b.n > 0.0 && a.no_merge < tick && b.no_merge < tick && dist(a.x, a.y, b.x, b.y) < 0.5 * (radius(a.n) + radius(b.n)) {
                    a.x = (a.x * a.n + b.x * b.n) / (a.n + b.n);
                    a.y = (a.y * a.n + b.y * b.n) / (a.n + b.n);
                    a.belly += b.belly; a.meal = a.meal.max(b.meal); a.n += b.n; b.n = 0.0;
                    a.manual = a.manual || b.manual;
                }
            }
        }
        for c in &mut self.swarms { if tick - c.meal > 400.0 { c.n *= 1.0 - 0.0008; } }
        self.swarms.retain(|c| c.n >= 1.0);
    }

    pub fn add_swarm(&mut self, side: usize, x: f64, y: f64, n: f64) -> f64 {
        if self.swarms.iter().filter(|c| c.side == side).count() >= 40 { return -1.0; }
        let id = self.next_id; self.next_id += 1.0;
        self.swarms.push(Swarm { id, side, x, y, n, tx: x, ty: y, manual: false, rule: -1.0,
            no_merge: 0.0, eng: false, belly: 0.0, meal: self.tick, roll: None });
        id
    }

    fn grow_planets(&mut self) {
        for i in 0..self.planets.len() {
            if self.planets[i].mass <= 0.0 { continue; }
            let mut pres = vec![0.0; self.teams.len()];
            let p = &self.planets[i];
            for c in &mut self.swarms {
                if dist(c.x, c.y, p.x, p.y) < p.r + radius(c.n) { pres[c.side] += c.n; c.meal = self.tick; }
            }
            let here: Vec<usize> = (0..self.teams.len()).filter(|&side| pres[side] > 0.0).collect();
            let p = &mut self.planets[i];
            if !here.is_empty() && here.iter().all(|&side| self.teams[side] == self.teams[here[0]]) {
                let q = here.iter().copied().reduce(|a, side| if pres[side] > pres[a] { side } else { a }).unwrap();
                let rate = pres[q].sqrt() / (p.r * 300.0);
                p.by = q as i32;
                if p.owner >= 0 && self.teams[p.owner as usize] == self.teams[q] { p.cap = (p.cap + rate).min(1.0); }
                else if p.owner >= 0 { p.cap -= rate; if p.cap <= 0.0 { p.owner = -1; p.cap = 0.0; p.prog = 0.0; } }
                else {
                    if p.claim != q as i32 { p.claim = q as i32; p.prog = 0.0; }
                    p.prog += rate;
                    if p.prog >= 1.0 { p.owner = q as i32; p.cap = 1.0; p.prog = 0.0; }
                }
            }
            if p.owner < 0 { continue; }
            let made = p.mass.min(p.r * 0.12); p.mass -= made; p.stock += made;
            if p.stock >= 60.0 || p.mass <= 0.0 {
                let (side, x, y, r, stock) = (p.owner as usize, p.x, p.y, p.r, p.stock);
                let near = self.swarms.iter().position(|c| c.side == side && dist(c.x, c.y, x, y) < r + radius(c.n) + 10.0);
                let target = if let Some(n) = near { Some(n) } else if self.add_swarm(side, x, y, 0.0) >= 0.0 { Some(self.swarms.len() - 1) } else {
                    let mut best = None; let mut bd = f64::INFINITY;
                    for (j, c) in self.swarms.iter().enumerate() {
                        let d = dist(c.x, c.y, x, y);
                        if c.side == side && d < bd { best = Some(j); bd = d; }
                    }
                    best
                };
                if let Some(j) = target { self.swarms[j].n += stock; }
                self.planets[i].stock = 0.0;
            }
        }
    }
}
