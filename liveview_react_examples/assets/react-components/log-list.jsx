import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLiveEvent, useLiveReact } from "liveview_react";

export function LogList() {
  const { pushEvent } = useLiveReact();
  const [items, setItems] = useState([]);
  const [showItems, setShowItems] = useState(true);
  const [body, setBody] = useState("");

  const addItem = (e) => {
    e.preventDefault();
    pushEvent("add_item", { body });
    setBody("");
  };

  const resetItems = () => setItems([]);

  useLiveEvent("new_item", (item) => {
    setItems((prevItems) => [item, ...prevItems]);
  });

  return (
    <div className="flex flex-col space-y-3">
      <label className="space-x-2">
        <input
          type="checkbox"
          checked={showItems}
          onChange={(e) => {
            setShowItems((current) => !current);
          }}
        />
        <span>show list</span>
      </label>

      <div className="flex space-x-2">
        <form className="space-x-2" onSubmit={addItem}>
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <button
            type="submit"
            className="bg-black rounded text-white px-2 py-1 font-bold cursor-pointer"
          >
            Add item
          </button>
        </form>
        <button
          type="submit"
          className="bg-black rounded text-white px-2 py-1 font-bold cursor-pointer"
          onClick={resetItems}
        >
          Reset items
        </button>
      </div>

      <div className="relative flex flex-col min-h-[400px] overflow-hidden">
        {showItems && (
          <AnimatePresence>
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, originY: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 350, damping: 40 }}
                layout
              >
                <div className="min-h-fit transform transition-all duration-200 ease-in-out py-2 border-t border-[#eee]">
                  {item.id}: {item.body}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
