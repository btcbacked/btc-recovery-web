/**
 * The exact bytes Sparrow wrote, committed base64 encoded.
 *
 * PROVENANCE: a real signed PSBT saved out of Sparrow on 27 Aug 2026, from a
 * contract holding a password key on one side and a Keystone on the other. It
 * is the only evidence this repo has of what Sparrow actually writes, which is
 * why it is committed verbatim rather than generated. Every other PSBT fixture
 * here comes from `buildTestPsbt()`, i.e. bytes this tool produced itself, so
 * none of them could ever have caught the defect this one pins: Sparrow saves
 * RAW BINARY (magic `70 73 62 74 ff`) and the upload only ever read text.
 *
 * Safe to commit: coin type 1' throughout, so regtest. Nothing spendable.
 *
 * Base64 rather than a binary file on disk because this repo has no
 * `@types/node`, so `node:fs` and `process` do not type-check.
 * `Buffer.from(SPARROW_BINARY_PSBT_BASE64, 'base64')` reproduces all 1025
 * bytes exactly.
 *
 * DO NOT regenerate this by round tripping through `psbt.toBase64()`. Measured:
 * that does NOT reproduce the original bytes (they first differ at offset 198),
 * so a regenerated fixture would stop being what Sparrow writes and the whole
 * point of the fixture would be gone while the test stayed green.
 */
export const SPARROW_BINARY_PSBT_BASE64 =
  'cHNidP8BAFICAAAAAVFVsLkmN3VEgHpG/C+ep2R/OZrwWuWpTk+ZY8Zs/L0WAAAAAAD9////AW4s' +
  'MQEAAAAAFgAUPzvV0QTL7L1uAIo16e0UhZazx7kd9wAATwEENYfPBAY52MbZuuaCmkf098Sc/CPX' +
  'a23lLJlolkCbOx43Rx+LErTwAiLuhwcDxDCSnih015PJxh4dv2fIMz6SsGGCTttwOU1xpRMPvW0U' +
  'Fqk+0FgAAIABAACAnGgEtYLmutlPAQQ1h88Eq7uP5IAAAAKfz6NdpS3fDB90BmCTIFFbbUsSmWz1' +
  'tsL3RaWI+q3aFAMPnGhofQ/jQ7WU7mbznc5B9vfgNW0sW+774iZSnOeCBBSaQOHdMAAAgAEAAIAA' +
  'AACAAgAAgE8BBDWHzwQ8najNgAAAAqzGwInK3TrTBJUMrU+PS/GztYV75tVbdvubXHb/wW05AoD7' +
  'PsV4WRPZ6yqlJq9pKN7wOZatywPmICZA/UlHnQMWFPFQIh8wAACAAQAAgAAAAIACAACAAAEApgIA' +
  'AAAC/qPzJHepSGJQAu2t4IAO/Iu148oR8EXAcm47pvaxL0IAAAAAAP3///+eOZWwgLlzpM6zrGLS' +
  'qHuyL5QSPbCTVBmP80toihvUtQAAAAAA/f///wIALTEBAAAAACIAILxujkStrRDOHrAJ5tB/SVsL' +
  'cOTDeIhccrD/lYQmf682SNyZAAAAAAAWABRIr6Pnp/oRdmsSV4uxrL2tVzUDexz3AAABASsALTEB' +
  'AAAAACIAILxujkStrRDOHrAJ5tB/SVsLcOTDeIhccrD/lYQmf682IgID3QEEBJpTW8bTWIdLtyhD' +
  'Kjjvcz98FbLF4VdKVPtZKe9HMEQCIHRURASEb3IYAAewb8voIETiXFdwbx43gi6WezkJpGL4AiBw' +
  'tt4zYUfMF7nt5OFf6hUSpGzPesyEcSTxdW6YYUyDLgEBAwQBAAAAAQVpUiEChMfsgGBhzX4hl0yi' +
  'gFaxStANycdwS9jt3NSmHJuG7kkhA8h3WVrWW5PgDHYMSsNYwp6hCC1Y6olZtwuZtDk29JnHIQPd' +
  'AQQEmlNbxtNYh0u3KEMqOO9zP3wVssXhV0pU+1kp71OuIgYDyHdZWtZbk+AMdgxKw1jCnqEILVjq' +
  'iVm3C5m0OTb0mcccFqk+0FgAAIABAACAnGgEtYLmutkAAAAADwAAACIGA90BBASaU1vG01iHS7co' +
  'Qyo473M/fBWyxeFXSlT7WSnvHJpA4d0wAACAAQAAgAAAAIACAACAAAAAAA8AAAAiBgKEx+yAYGHN' +
  'fiGXTKKAVrFK0A3Jx3BL2O3c1KYcm4buSRzxUCIfMAAAgAEAAIAAAACAAgAAgAAAAAAPAAAAAAA='

/** The length of the real file, so a truncated paste of the above is caught. */
export const SPARROW_BINARY_PSBT_BYTES = 1025
