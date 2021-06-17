rm -rf config.tar.gz
rm -rf config.tar.gz.gpg
tar -czvf config.tar.gz config
gpg -c config.tar.gz
rm config.tar.gz
