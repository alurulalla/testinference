/** A section that exists in the navigation but is still being built. */
export default function SoonPanel({ what }: { what: string }) {
  const [name, description] = what.split("|");

  return (
    <section className="card soon">
      <h1>{name}</h1>
      <p className="lede">Development in progress.</p>
      <p className="hint">This is where {description} will live.</p>
      <p className="hint">
        Test design and test cases work today. The rest of the navigation shows where the product is
        going rather than hiding it until it arrives.
      </p>
    </section>
  );
}
