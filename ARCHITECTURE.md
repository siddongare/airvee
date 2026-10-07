# Airvee — System Architecture & Mathematical Foundations

Airvee is engineered as a high-performance, zero-backend, privacy-sovereign Chrome Extension built on Chrome Manifest V3. This document outlines the mathematical models, geometry engines, state management, and real-time audio synthesis that power Airvee.

---

## 📐 1. Kinematic Geometry & Closest Point of Approach (CPA)

Airvee does not simply calculate current distance; it projects future aircraft trajectories to alert users *before* an aircraft reaches their overhead zenith.

### 1.1 Earth Curvature & Haversine Distance
The spherical distance $d$ between observer $(\phi_1, \lambda_1)$ and aircraft $(\phi_2, \lambda_2)$ is calculated using the Haversine formulation:

$$\Delta\phi = \phi_2 - \phi_1, \quad \Delta\lambda = \lambda_2 - \lambda_1$$
$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$
$$d = 2 R \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$

where $R = 6,371\text{ km}$ is Earth's mean radius.

### 1.2 Local Tangent Plane Projection
To perform closed-form vector kinematics without spherical trigonometric degradation at small scales, coordinates are mapped onto a local East-North-Up (ENU) Euclidean tangent plane:

$$x = R \cdot (\lambda_2 - \lambda_1) \cdot \cos\left(\frac{\phi_1 + \phi_2}{2}\right)$$
$$y = R \cdot (\phi_2 - \phi_1)$$

where $x$ represents Eastward displacement and $y$ represents Northward displacement.

### 1.3 CPA Time ($t_{\text{CPA}}$) and Distance ($d_{\text{CPA}}$)
Let $\mathbf{p} = [x, y]^T$ be the displacement vector and $\mathbf{v} = [v_x, v_y]^T$ be the aircraft velocity vector derived from ground speed $V$ (converted from knots to km/s) and true heading $\theta$:

$$v_x = V \cdot \sin(\theta), \quad v_y = V \cdot \cos(\theta)$$

Relative position as a function of elapsed time $t$ is:

$$\mathbf{r}(t) = \mathbf{p} + \mathbf{v}t$$

Minimizing the squared Euclidean distance $\|\mathbf{r}(t)\|^2$:

$$\frac{d}{dt}\|\mathbf{r}(t)\|^2 = 2(\mathbf{p} + \mathbf{v}t) \cdot \mathbf{v} = 0$$
$$t_{\text{CPA}} = -\frac{\mathbf{p} \cdot \mathbf{v}}{\|\mathbf{v}\|^2} = -\frac{x v_x + y v_y}{v_x^2 + v_y^2}$$

- If $t_{\text{CPA}} > 0$: The aircraft is **inbound** toward the observer station.
- If $t_{\text{CPA}} \le 0$: The aircraft is **flying away**.

The closest horizontal distance at CPA is:

$$d_{\text{CPA}} = \|\mathbf{p} + \mathbf{v} t_{\text{CPA}}\| = \sqrt{(x + v_x t_{\text{CPA}})^2 + (y + v_y t_{\text{CPA}})^2}$$

### 1.4 Curvature-Corrected Elevation Angle
For high-altitude targets ($h \approx 30,000 - 43,000\text{ ft}$), Earth curvature causes the geometric horizon to drop by approximately:

$$\Delta h_{\text{drop}} \approx \frac{d^2}{2 R}$$

The true optical elevation angle $\alpha$ is computed as:

$$\alpha = \operatorname{atan2}\left((h_{\text{aircraft}} - h_{\text{ground}} - \Delta h_{\text{drop}}), d\right)$$

---

## ☀️ 2. NOAA Solar Elevation & Optical Visibility Classification

To determine whether an aircraft passing overhead will produce a visible white contrail, catch golden hour sunlight, or display anti-collision strobes, Airvee implements the **NOAA Solar Astronomical Algorithm**:

1. **Julian Century** $T$ from UTC timestamp.
2. **Geometric Mean Solar Longitude** $L_0$ and **Mean Anomaly** $M$.
3. **Equation of the Center** $C$ to derive True Longitude $\odot$.
4. **Solar Declination** $\delta$ and **Equation of Time** $E_{\text{time}}$.
5. **Solar Zenith & Elevation**:
   $$\sin(\alpha_{\text{sun}}) = \sin(\phi)\sin(\delta) + \cos(\phi)\cos(\delta)\cos(\text{HA})$$

Combined with localized 30-minute cached cloud cover from Open-Meteo, Airvee assigns optical visibility regimes (`Day`, `Golden Hour`, `Civil Twilight`, `Nautical Twilight`, `Night`) and computes contrast hints (`High`, `Medium`, `Low`).

---

## 📡 3. Canvas Radar Scope

The radar view (`lib/radar.js`) utilizes the HTML5 2D Canvas API:

- **Cartesian-Polar Mapping**: Aircraft polar coordinates $(r, \theta)$ are projected onto the pixel canvas:
  $$x_{\text{canvas}} = c_x + \left(\frac{d}{R_{\text{max}}}\right) r_{\text{scope}} \cdot \sin(\theta - \theta_{\text{offset}})$$
  $$y_{\text{canvas}} = c_y - \left(\frac{d}{R_{\text{max}}}\right) r_{\text{scope}} \cdot \cos(\theta - \theta_{\text{offset}})$$
- **Facing-Up Rotation**: When $\theta_{\text{offset}} = \text{userFacing}$ (e.g. South $180^\circ$), what is directly in front of the observer is rotated to 12 o'clock ($-\frac{\pi}{2}$).
- **Lifecycle Efficiency**: Background animation frames are canceled via `stop()` whenever the user navigates away from the Radar tab, reducing idle CPU usage to 0%.

---

## 🔊 4. Web Audio API Acoustic Chime Synthesis

Airvee requires no MP3 or WAV audio assets for alert chimes. Using the Web Audio API in an isolated Offscreen Document (`offscreen.html`), chimes are synthesized directly in software:

1. **Normal Chime**: A two-tone major third chord ($E_5 \approx 659.25\text{ Hz} \to C_5 \approx 523.25\text{ Hz}$) with exponential decay gain envelopes simulating an airport terminal chime.
2. **Special / Watchlist Chime**: A 3-tone ascending chime ($C_5 \to G_5 \to C_6$) with harmonic overtones and high resonance for high-priority watchlist flights.
