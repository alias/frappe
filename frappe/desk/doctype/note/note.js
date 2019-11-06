frappe.ui.form.on("Note", {
	refresh: function (frm) {
		if (!frm.is_new()) {
			frm.is_note_editable = false;
			frm.events.set_editable(frm);
		}
	},
	set_editable: function (frm) {
		if (frm.has_perm("write")) {
			const read_label = __("Read mode");
			const edit_label = __("Edit mode");
			frm.remove_custom_button(frm.is_note_editable ? edit_label : read_label);
			frm.add_custom_button(frm.is_note_editable ? read_label : edit_label, function () {
				frm.is_note_editable = !frm.is_note_editable;
				frm.events.set_editable(frm);
			});
		}
		// toggle "read_only" for content and "hidden" of all other fields

		// content read_only
		frm.set_df_property("content", "read_only", frm.is_note_editable ? 0 : 1);
		frm.set_df_property("developer_content", "read_only", frm.is_note_editable ? 0: 1);
		frm.set_df_property("marketing_content", "read_only", frm.is_note_editable ? 0: 1);
		// hide all other fields
		for (const field of frm.meta.fields) {
			if (!["content", "section_break_4", "developer_content", "marketing_content", "developer_note", "marketing_note"].includes(field.fieldname)) {
				frm.set_df_property(
					field.fieldname,
					"hidden",
					frm.is_note_editable && !field.hidden && frm.get_perm(field.permlevel, "write")
						? 0
						: 1
				);
			}
		}

		// no label, description for content either
		frm.get_field("content").toggle_label(frm.is_note_editable);
		frm.get_field("developer_content").toggle_label(frm.is_note_editable);
		frm.get_field("marketing_content").toggle_label(frm.is_note_editable);

		frm.get_field("content").toggle_description(frm.is_note_editable);
		frm.get_field("developer_content").toggle_description(frm.is_note_editable);
		frm.get_field("marketing_content").toggle_description(frm.is_note_editable);

	},
});

frappe.tour["Note"] = [
	{
		fieldname: "title",
		title: "Title of the Note",
		description: "This is the name by which the note will be saved, you can change this later",
	},
	{
		fieldname: "public",
		title: "Sets the Note to Public",
		description:
			"You can change the visibility of the note with this, setting it to public will allow other users to view it.",
	},
];
