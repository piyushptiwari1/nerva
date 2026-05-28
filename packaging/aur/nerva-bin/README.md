# AUR package — `nerva-bin`

This directory tracks the [Arch User Repository](https://aur.archlinux.org/) submission for Nerva.

## Files
- [`PKGBUILD`](PKGBUILD) — repacks the upstream signed `.deb` (Arch users get the bit-for-bit identical binary).
- [`.SRCINFO`](.SRCINFO) — generated metadata required by AUR git server.

## First-time submission

```bash
# 1. Generate a fresh SSH key for AUR (recommended; separate from GitHub)
ssh-keygen -t ed25519 -C "aur" -f ~/.ssh/aur

cat <<EOF >> ~/.ssh/config
Host aur.archlinux.org
  IdentityFile ~/.ssh/aur
  User aur
EOF

# 2. Add public key at https://aur.archlinux.org/account/ → My Account
cat ~/.ssh/aur.pub
# Account: piyushptiwari (or register at https://aur.archlinux.org/register)

# 3. Clone the (empty) AUR repo and copy our files in
cd /tmp
git clone ssh://aur@aur.archlinux.org/nerva-bin.git
cp packaging/aur/nerva-bin/PKGBUILD nerva-bin/
cp packaging/aur/nerva-bin/.SRCINFO nerva-bin/
cd nerva-bin
git add PKGBUILD .SRCINFO
git commit -m "Initial import of nerva-bin 0.1.1"
git push origin master
```

## On every release

```bash
# 1. Bump pkgver + sha256sums in PKGBUILD
sed -i "s/^pkgver=.*/pkgver=$NEW/" PKGBUILD
NEW_SHA=$(curl -fsSL https://github.com/piyushptiwari1/nerva/releases/download/v$NEW/Nerva_${NEW}_amd64.deb | sha256sum | cut -d' ' -f1)
sed -i "s/^sha256sums=.*/sha256sums=('$NEW_SHA')/" PKGBUILD

# 2. Regenerate .SRCINFO
makepkg --printsrcinfo > .SRCINFO

# 3. Push
git -C /tmp/nerva-bin add PKGBUILD .SRCINFO
git -C /tmp/nerva-bin commit -m "Update to $NEW"
git -C /tmp/nerva-bin push origin master
```

## Local test before pushing

```bash
cd packaging/aur/nerva-bin
makepkg -si --noconfirm   # builds + installs locally on Arch
nerva                     # smoke test
sudo pacman -R nerva-bin  # clean up
```

## Future: source package (`nerva`)

A from-source AUR package would build with `cargo` + `pnpm`/`bun` against the upstream tag. ~3 GB of build deps and ~30 min on a clean machine. Tracked as a `TODO` in `docs/ROADMAP.md` once we have a build farm.
