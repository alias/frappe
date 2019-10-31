frappe.provide('frappe.ui.misc');


function getGitChangelog(app){
    frappe.call({
        method:"frappe.utils.change_log.get_git_changelog",
        args: {
            app: app
        },
        callback: function(r) {
            console.log(r);
            frappe.msgprint(r);
        }
    });
}


frappe.ui.misc.about = function() {
	if(!frappe.ui.misc.about_dialog) {
		var d = new frappe.ui.Dialog({title: __('Frappe Framework')});

		$(d.body).html(repl("<div>\
		<p>"+__("Open Source Applications for the Web")+"</p>  \
		<p><i class='fa fa-globe fa-fw'></i>\
			Website: <a href='https://frappe.io' target='_blank'>https://frappe.io</a></p>\
		<p><i class='fa fa-github fa-fw'></i>\
			Source: <a href='https://github.com/frappe' target='_blank'>https://github.com/frappe</a></p>\
		<hr>\
		<h4>Installed Apps</h4>\
		<div id='about-app-versions'>Loading versions...</div>\
		<hr>\
		<p class='text-muted'>&copy; Frappe Technologies Pvt. Ltd and contributors </p> \
		</div>", frappe.app));

		frappe.ui.misc.about_dialog = d;

		frappe.ui.misc.about_dialog.on_page_show = function() {
			if(!frappe.versions) {
				frappe.call({
					method: "frappe.utils.change_log.get_versions",
					callback: function(r) {
						show_versions(r.message);
					}
				})
			} else {
				show_versions(frappe.versions);
			}
		};

		var show_versions = function(versions) {
			var $wrap = $("#about-app-versions").empty();
			$.each(Object.keys(versions).sort(), function(i, key) {
				var v = versions[key];
          v.title = '<a href="#"><b>' + v.title + '</b></a>';
				if(v.branch) {
					  var title = $(v.title).click(() => getGitChangelog(key));
					  var text = $("<p>").append(title).append($.format('v{0} ({1})<br>',
                                                              [v.branch_version || v.version, v.branch]));
					// var text = $.format('<p><b>{0}:</b> v{1} ({2})<br></p>',
					// 	                  [v.title, v.branch_version || v.version, v.branch]);
				} else {
					  var text = $(v.title).click(() => alert('lol')).wrap($("<b></b>"));
           //  $.format('<p><b>{0}:</b> v{1}<br></p>',
						                  // [, v.version])
				}
				  $(text).appendTo($wrap);
			});

			frappe.versions = versions;
		}

	}

	frappe.ui.misc.about_dialog.show();

}
