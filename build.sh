set -e

mkdir -p node_modules/@blainehansen
ln -sf -T $(pwd)/lib 'node_modules/@blainehansen/macro-ts'
npx ts-node bin/cli.ts build

# https://stackoverflow.com/questions/10587615/unix-command-to-prepend-text-to-a-file
FILES=./.macro-ts/dist/node-latest/bin/*.js
for FILE in $FILES
do
	echo "prepending hashbang to: $FILE"
	printf '%s\n%s' "#!/usr/bin/env node" "$(cat $FILE)" > $FILE
done

chmod +x ./.macro-ts/dist/node-latest/bin/cli.js
./.macro-ts/dist/node-latest/bin/cli.js check
./.macro-ts/dist/node-latest/bin/cli.js check examples/use.ts
./.macro-ts/dist/node-latest/bin/cli.js run examples/use.ts

rm -rf ./.macro-ts/dist/browser* dist
mv .macro-ts/dist dist

mkdir -p ./register
cat << EOF > ./register/index.js
require('../dist/node-latest/bin/register')
EOF
