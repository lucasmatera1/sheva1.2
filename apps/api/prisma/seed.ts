async function main() {
  console.log("Seed desabilitado ate o schema real do dominio ser mapeado.");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });