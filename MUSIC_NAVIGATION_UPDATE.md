# CHATHIS Navigation and Music Upload Update

## Navigation
- Desktop sidebar remains pinned in the viewport while its own contents can scroll if needed.
- The top search/navigation bar remains visible while the main page scrolls.
- The mobile bottom navigation remains fixed.

## Music uploads
- The Music file picker accepts `audio/*` and common audio extensions including MP3, WAV, OGG/OGA, OPUS, AAC, M4A/MP4 audio, FLAC, WEBM, AIFF, APE, ALAC, AMR, MIDI, WMA, CAF, AU, DSF and DFF.
- The server accepts audio MIME types and known audio extensions where the browser reports a generic MIME type.
- Existing upload size limit remains 30 MB by default and can be changed with `MAX_SONG_MB`.
- Cloudinary stores uploaded audio using its `video` resource type; song metadata remains in the configured database.
- Upload acceptance does not guarantee every browser can decode/play every codec. MP3, WAV, AAC/M4A and OGG are generally safer choices for broad browser playback.
