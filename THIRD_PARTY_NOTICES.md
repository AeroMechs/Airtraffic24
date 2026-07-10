# Third-Party Notices

## Aircraft 3D Models

The aircraft models bundled in `public/models/aircraft` include work from the
following projects:

- **FlightAirMap 3D Models**
  - Repository: https://github.com/Ysurac/FlightAirMap-3dmodels
  - License: GNU General Public License v2 (GPL-2.0)
  - Models: narrowbody, widebody-2eng, widebody-4eng (A380), regional-jet,
    light-prop, turboprop, helicopter, bizjet, glider, fighter, drone, and
    generic.

- **Flightradar24 3D Models**
  - Repository: https://github.com/Flightradar24/fr24-3d-models
  - Original source: https://github.com/FGMEMBERS/737NG
  - License: GNU General Public License v2 (GPL-2.0)
  - Model: b737.

The bundled copies have been optimized for web delivery. Textures were
removed, materials use neutral unlit white, meshes were deduplicated and
pruned, and most models were simplified. The files do not use Draco
compression, so no external WASM decoder is required. The B737 was converted
from glTF 1.0 to glTF 2.0.

The GPL v2 license text is available at
https://www.gnu.org/licenses/old-licenses/gpl-2.0.html.
