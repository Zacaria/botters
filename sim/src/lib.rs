use wasm_bindgen::prelude::*;

// V8 scales and sums the arguments in order to preserve Math.hypot's rounding.
#[wasm_bindgen]
pub fn hypot(a: f64, b: f64) -> f64 {
    let values = [a.abs(), b.abs()];
    let max = values[0].max(values[1]);
    if max == 0.0 { return 0.0; }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for value in values {
        let n = value / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

#[wasm_bindgen]
pub fn random_next(state: u32) -> u32 {
    let mut t = state;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    t ^ (t >> 14)
}

#[wasm_bindgen]
pub fn side_totals(sides: usize, populations: &[f64]) -> Vec<f64> {
    (0..sides).map(|side| {
        let mut total = 0.0;
        for swarm in populations.chunks_exact(2) {
            total += if swarm[0] == side as f64 { swarm[1] } else { 0.0 };
        }
        let lower = total.floor();
        if total - lower >= 0.5 { lower + 1.0 } else { lower }
    }).collect()
}

struct Planet { x: f64, y: f64, r: f64, owner: i32 }

#[wasm_bindgen]
pub fn initial_geometry(seed: u32, sides: usize, count: usize) -> String {
    let homes: &[(f64, f64)] = match sides {
        2 => &[(90., 350.), (1110., 350.)],
        4 => &[(130., 170.), (130., 530.), (1070., 170.), (1070., 530.)],
        6 => &[(100., 350.), (350., 116.), (850., 116.), (1100., 350.), (850., 584.), (350., 584.)],
        _ => return String::new(),
    };
    let mut planets: Vec<Planet> = homes.iter().enumerate().map(|(side, &(x, y))| Planet { x, y, r: 26., owner: side as i32 }).collect();
    let mut state = seed;
    let mut random = || {
        state = state.wrapping_add(0x6d2b79f5);
        random_next(state) as f64 / 4294967296.0
    };
    for _ in 0..5000 {
        if planets.len() >= count { break; }
        let pair = sides > 2 && (count - planets.len()) % 4 == 2;
        let r = (6. + random() * 16. + 0.5).floor();
        let x = 180. + random() * (1200. / 2. - 210.);
        let y = if pair { 700. / 2. } else if sides == 2 { 40. + random() * (700. - 80.) } else { 40. + random() * (700. / 2. - 90. - r) };
        if planets.iter().any(|p| hypot(p.x - x, p.y - y) < p.r + r + 50.) { continue; }
        planets.push(Planet { x, y, r, owner: -1 });
        planets.push(Planet { x: 1200. - x, y, r, owner: -1 });
        if sides != 2 && !pair {
            planets.push(Planet { x, y: 700. - y, r, owner: -1 });
            planets.push(Planet { x: 1200. - x, y: 700. - y, r, owner: -1 });
        }
    }
    let mut out = String::from("{\"planets\":[");
    for (i, p) in planets.iter().enumerate() {
        if i > 0 { out.push(','); }
        let mass = if p.r == 26. { 15000. } else { p.r * p.r * 25. };
        out.push_str(&format!("{{\"x\":{},\"y\":{},\"r\":{},\"owner\":{},\"cap\":{},\"id\":{},\"m0\":{},\"mass\":{},\"stock\":0,\"prog\":0,\"claim\":-1,\"by\":-1}}", p.x, p.y, p.r, p.owner, if p.owner < 0 { 0 } else { 1 }, i, mass, mass));
    }
    out.push_str("],\"swarms\":[");
    for side in 0..sides {
        let p = &planets[side];
        let len = hypot(600. - p.x, 350. - p.y);
        let ux = (600. - p.x) / len;
        let uy = (350. - p.y) / len;
        for i in 0..3 {
            if side != 0 || i != 0 { out.push(','); }
            let x = p.x + ux * 45. - uy * (i as f64 - 1.) * 70.;
            let y = p.y + uy * 45. + ux * (i as f64 - 1.) * 70.;
            out.push_str(&format!("{{\"id\":{},\"side\":{},\"x\":{},\"y\":{},\"n\":3000,\"tx\":{},\"ty\":{},\"manual\":false,\"rule\":-1,\"noMerge\":0,\"eng\":false,\"belly\":0,\"meal\":0}}", side * 3 + i + 1, side, x, y, x, y));
        }
    }
    out.push_str("]}");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_hypot() { assert_eq!(hypot(0.0, 0.0), 0.0); }
}
