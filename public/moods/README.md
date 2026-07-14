# Fallback clips (the safety net)

Demo mode plays these instead of calling the model. Record them EARLY (see build
plan minute ~40) so you always have a working demo even if live gen is slow.

Drop MP3s here matching the names in `lib/fallback.ts`:

    chill-1.mp3   chill-2.mp3   chill-3.mp3
    intense-1.mp3 intense-2.mp3 intense-3.mp3
    dreamy-1.mp3  dreamy-2.mp3  dreamy-3.mp3

Each ~8s. Easiest way: run the app in Live mode, let it generate, and save the
chunks — or generate a batch straight from https://replicate.com/meta/musicgen.
Missing files are skipped gracefully, but demo mode is your insurance — fill it.
