#!/bin/sh
# Answers one question: is what production serves the same as what is committed here?
#
# Run it before saying "deployed". On 2026-09-12 a whole session's work was reported
# as pushed while production served a commit from seven weeks earlier - the work had
# gone to the outer insole-ai-design repo, which deploys nowhere.
set -e
cd "$(dirname "$0")/.."

echo "repository : $(git remote get-url origin)"
case "$(git remote get-url origin)" in
    *Bionicsole_lab*) ;;
    *) echo "  WRONG REPO - this is not the one that deploys. Run from masacad/." ; exit 1 ;;
esac

branch=$(git rev-parse --abbrev-ref HEAD)
echo "branch     : $branch"
echo "local HEAD : $(git rev-parse --short HEAD)  $(git log -1 --format=%s | cut -c1-60)"

git fetch -q origin 2>/dev/null || echo "  (fetch failed - offline?)"
echo "origin/main: $(git rev-parse --short origin/main)  $(git log -1 --format=%s origin/main | cut -c1-60)"

ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
echo "            $ahead ahead, $behind behind main"

uncommitted=$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')
echo "uncommitted tracked changes: $uncommitted"

echo
if [ "$ahead" != "0" ] || [ "$uncommitted" != "0" ]; then
    echo "NOT LIVE: work here is not on main."
    echo "  Production deploys from Bionicsole_lab main. Open a PR and merge it,"
    echo "  then confirm the new deployment at vercel.com before calling it done."
else
    echo "In sync with main. Production follows main, so check the latest deployment"
    echo "actually succeeded - a green push is not a green deploy."
fi
echo
echo "Remember: the Python engine ships with the BACKEND. A frontend-only deploy"
echo "leaves the insole geometry unchanged."
echo
echo "Production URL (the only publicly reachable one - the other two Vercel"
echo "domains redirect to Vercel SSO):"
echo "  https://frontend-smoky-one-57.vercel.app"
printf "  reachable: "
curl -s -o /dev/null -w "%{http_code}
" --max-time 15 https://frontend-smoky-one-57.vercel.app || echo "(offline)"
