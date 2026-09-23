# Bank logos

From [idn-finlogos](https://github.com/hafidznoor/idn-finlogos) 2.5.0 (npm), curated by Hafidz Noor Fauzi and licensed [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). The marks belong to their banks; using them here doesn't imply any endorsement. Fine for a household app. Selling the app would break the NonCommercial term.

Changes: added `xmlns="http://www.w3.org/2000/svg"` to each root `<svg>` so browsers render the files through `<img>`. Otherwise unchanged.

| File | Source file in the package |
| --- | --- |
| `jago.svg` | `dist/icons/jago-app.svg` (the square app mark, fits a tile better than the wordmark) |
| `blu.svg` | `dist/icons/blu-bca.svg` |
| `superbank.svg` | `dist/icons/superbank.svg` |
| `bca.svg` | `dist/icons/bca.svg` |

To add a bank: add it to `utils/banks.js`, then drop `<key>.svg` here. Until the file exists, the app shows a letter badge in the bank's colour.
